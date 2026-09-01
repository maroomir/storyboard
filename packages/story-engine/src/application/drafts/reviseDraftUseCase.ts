import type { StoryUri } from '@storyboard/story-format';
import type { IStoryboardLogger } from '../../ports/logger';
import { sceneContextPaths } from '../../paths/sceneContextPaths';
import { joinUri, type StoryboardProjectPaths } from '../../paths/projectPaths';
import { sceneCacheFilePath } from '../../persistence/sceneCacheWorkspace';
import {
  buildNarrativeContext,
  buildSceneContext,
  createDraft,
  formatBibleFactLines,
  readStoryState,
  storyStateFactLines,
  computeDraftBodyHash,
  parseDraft,
  serializeDraft,
  readDraftFile,
  readSceneFile,
  writeDraftFile,
} from '@storyboard/story-format';
import type { ProjectSetting } from '@storyboard/story-format';
import type { IFileSystem } from '../../ports/fileSystem';
import type { ISceneCacheRepository } from '../../ports/repositories';
import { readProjectJson } from '../../persistence/projectJson';
import { buildStyleDirective, formatAugmentCards, StoryboardAIService } from '@storyboard/story-ai';
import type { AiProviderRegistry, UsageAttribution } from '@storyboard/story-ai';
import type { IUsageSink } from '../../ports/usageSink';
import {
  type DraftCandidateRejectionReason,
  resolveSceneTargetLength,
  runReviseLoop,
  type ReviseLoopContext,
} from '@storyboard/story-pipeline';

async function readContractGuidance(
  fs: IFileSystem,
  projectJsonUri: StoryUri,
): Promise<{
  styleConstraints: readonly string[];
  qualityCriteria: readonly string[];
  setting?: ProjectSetting;
}> {
  try {
    const project = await readProjectJson(fs, projectJsonUri);
    return {
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      setting: project.setting,
    };
  } catch {
    return { styleConstraints: [], qualityCriteria: [] };
  }
}

export interface ReviseDraftUseCaseDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly usageSink: IUsageSink;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly generator: string;
  // Rewriting the draft invalidates the body hash the scene cache recorded at generation time.
  // Without this the next generation reads the draft as somebody else's work and archives it with
  // a false "hand-edited" warning on every single run.
  readonly sceneCacheRepository?: ISceneCacheRepository;
}

export interface ReviseDraftRequest {
  readonly workspaceUri: StoryUri;
  readonly paths: StoryboardProjectPaths;
  readonly draftUri: StoryUri;
  readonly sceneStem: string;
  readonly maxIterations: number;
  readonly maxCompressionPercent: number;
  readonly reviseScoreThreshold: number;
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
}

export interface ReviseDraftWorkflowResult {
  readonly passed: boolean;
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly cancelled: boolean;
  readonly instructions: readonly string[];
  readonly preservedOriginal: boolean;
  readonly rejection?: {
    readonly reason: DraftCandidateRejectionReason;
    readonly originalLength: number;
    readonly candidateLength: number;
  };
}

interface ReviseDraftContext {
  readonly loop: ReviseLoopContext;
  readonly draft: ReturnType<typeof parseDraft>;
}

async function prepareReviseDraftContext(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  draftUri: StoryUri,
  sceneStem: string,
): Promise<ReviseDraftContext> {
  const sceneFileName = `${sceneStem}.card`;
  const scene = await readSceneFile(
    joinUri(paths.sceneDirectory, sceneFileName),
    fs,
    sceneFileName,
  );
  const ctxPaths = sceneContextPaths(paths);
  const context = await buildSceneContext(ctxPaths, scene, fs);
  const narrative = await buildNarrativeContext(ctxPaths, context, fs);
  const canonFactLines = formatBibleFactLines(context, narrative.bibleFacts);
  // NOTE: 앞 씬이 확립한 사실·이미 공개된 정보와의 모순도 캐넌과 같은 기준으로 검사한다.
  const priorState = await readStoryState(paths.storyState, fs);
  const factLines = [
    ...canonFactLines,
    ...storyStateFactLines(priorState, scene.order, scene.body),
  ];
  const { styleConstraints, qualityCriteria, setting } = await readContractGuidance(
    fs,
    paths.projectJson,
  );

  const draft = parseDraft(await readDraftFile(draftUri, fs));

  return {
    draft,
    loop: {
      format: draft.format,
      intent: scene.body,
      factLines,
      characterNames: context.characters.map((character) => character.name),
      characterCards: formatAugmentCards(context.characters, undefined),
      styleConstraints,
      qualityCriteria,
      styleDirective: buildStyleDirective(
        setting,
        scene.frontmatter.relationStage,
        scene.frontmatter.targetWordCount,
        scene.body,
        scene.frontmatter.povCharacter,
      ),
      characters: context.characters,
      targetLength: resolveSceneTargetLength(scene.frontmatter.targetWordCount, scene.body),
    },
  };
}
async function runReviseDraftWorkflow(
  options: ReviseDraftUseCaseDependencies & ReviseDraftRequest,
): Promise<ReviseDraftWorkflowResult> {
  const { paths, draftUri, sceneStem, maxIterations, reviseScoreThreshold, maxCompressionPercent } =
    options;

  const aiService = new StoryboardAIService(options.aiProviderRegistry, {
    onUsage: (record): void => {
      void options.usageSink
        .record(options.workspaceUri, record)
        .catch((error: unknown) => options.logger.error('사용량 기록에 실패했습니다.', error));
    },
  });
  const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
  const ctx = await prepareReviseDraftContext(options.fileSystem, paths, draftUri, sceneStem);

  const result = await runReviseLoop({
    aiService,
    registry: options.aiProviderRegistry,
    attribution,
    ctx: ctx.loop,
    body: ctx.draft.body,
    maxIterations,
    reviseScoreThreshold,
    maxCompressionPercent,
    onProgress: options.onProgress,
    shouldCancel: options.shouldCancel,
  });

  if (result.revisionCount > 0 && !result.rejection && !result.cancelled) {
    const revisionConfig = options.aiProviderRegistry.getTaskAiConfig('draftRevision');
    const revised = createDraft({
      sceneStem,
      format: ctx.draft.format,
      body: result.body,
      // 생성 단계가 못 고치고 남긴 위반(사라진 대사·분량 미달 등)은 수정 루프가 다루는 문제와
      // 다르다. 여기서 빠뜨리면 헤더에서 사라져 읽는 사람이 영영 보지 못한다.
      warnings: ctx.draft.warnings,
      generator: options.generator,
      providerId: revisionConfig.providerId,
      model: revisionConfig.model,
    });

    await writeDraftFile(draftUri, options.fileSystem, revised);
    await refreshSceneCacheBodyHash(options, sceneStem, revised);
  }

  return {
    passed: result.passed,
    revisionCount: result.revisionCount,
    remainingBlocking: result.remainingBlocking,
    cancelled: result.cancelled,
    instructions: result.instructions,
    preservedOriginal: result.preservedOriginal,
    rejection: result.rejection,
  };
}

// The cache record is the generation's provenance, not the revision's, so only the body hash moves.
// A workspace with no record yet (a draft written before caching, or a host that keeps none) simply
// has nothing to refresh.
async function refreshSceneCacheBodyHash(
  options: ReviseDraftRequest & ReviseDraftUseCaseDependencies,
  sceneStem: string,
  revised: ReturnType<typeof createDraft>,
): Promise<void> {
  const repository = options.sceneCacheRepository;

  if (!repository) {
    return;
  }

  const cacheUri = sceneCacheFilePath(options.paths, sceneStem);

  try {
    const record = await repository.read(cacheUri);
    await repository.write(cacheUri, {
      ...record,
      bodyHash: computeDraftBodyHash(parseDraft(serializeDraft(revised)).body),
    });
  } catch (error) {
    options.logger.warn(`씬 캐시의 본문 해시를 갱신하지 못했습니다: ${String(error)}`);
  }
}

export class ReviseDraftUseCase {
  public constructor(private readonly dependencies: ReviseDraftUseCaseDependencies) {}

  public async execute(request: ReviseDraftRequest): Promise<ReviseDraftWorkflowResult> {
    return await runReviseDraftWorkflow({ ...this.dependencies, ...request });
  }
}
