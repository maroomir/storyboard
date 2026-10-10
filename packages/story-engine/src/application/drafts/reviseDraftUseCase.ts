import type {
  StoryUri,
  NarrationDirective,
  StoryboardProject,
  UsageAttribution,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import {
  sceneContextPaths,
  joinUri,
  type StoryboardProjectPaths,
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
  resolveNarration,
  writeDraftFile,
  resolveSceneTargetLength,
  buildStyleDirective,
  type SceneBeat,
} from '@storyboard/story-model';
import { sceneCacheFilePath } from '#engine/persistence/sceneCacheWorkspace';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneCacheRepository } from '#engine/application/drafts/draftRepositories';
import { readProjectJson } from '#engine/persistence/projectJson';
import { readChapterNarrationDefaults, resolveSceneNarration } from './resolveSceneNarration';
import { resolveSceneThread } from './resolveSceneThread';
import { formatAugmentCards, StoryboardAiService } from '@storyboard/story-ai';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { IUsageSink } from '#engine/ports/usageSink';
import { type DraftCandidateRejectionReason } from '#engine/pipeline/draftCandidateValidation';
import { listSceneCoordinates, sceneCoordinatesFromBeats } from '#engine/pipeline/sceneCoordinates';
import {
  runReviseLoop,
  type ReviseLoopContext,
  type ReviseLoopFailure,
  type ReviseSeedIssues,
} from '#engine/pipeline/reviseLoop';

async function readProjectIfPresent(
  fs: IFileSystem,
  projectJsonUri: StoryUri,
): Promise<StoryboardProject | undefined> {
  try {
    return await readProjectJson(fs, projectJsonUri);
  } catch {
    return undefined;
  }
}

// NOTE: 생성과 같은 규칙으로 줄기와 시점을 해석한다. 메인 원장과 `setting.pov`만 보면 옴니버스의
// 다른 줄기 씬을 다른 줄기의 사실과 다른 서술자 기준으로 검수하게 된다.
async function resolveReviseNarration(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  scene: Awaited<ReturnType<typeof readSceneFile>>,
  project: StoryboardProject | undefined,
): Promise<{
  readonly threadPaths: StoryboardProjectPaths;
  readonly previousSceneOrder: number | undefined;
  readonly narration: NarrationDirective | undefined;
}> {
  if (project === undefined) {
    return {
      threadPaths: paths,
      previousSceneOrder: undefined,
      narration: resolveNarration({ focalFallback: scene.frontmatter.povCharacter }),
    };
  }

  const chapterDefaults = await readChapterNarrationDefaults(paths, scene.order, fs);
  const thread = await resolveSceneThread(paths, scene, project, fs, chapterDefaults.thread);
  const narration = await resolveSceneNarration(paths, scene, project, chapterDefaults, fs);

  return {
    threadPaths: thread.threadPaths,
    previousSceneOrder: thread.previousSceneOrder,
    narration,
  };
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
  // Issues the final review found while reading the whole assembled volume, which a per-scene
  // check cannot see on its own.
  readonly seedIssues?: ReviseSeedIssues;
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
  readonly failure?: ReviseLoopFailure;
}

export type ReviseOutcomeStatus =
  | 'passed'
  | 'applied'
  | 'unresolved'
  | 'rejected'
  | 'timeout'
  | 'failed'
  | 'cancelled';

export interface ReviseOutcome {
  readonly status: ReviseOutcomeStatus;
  readonly revisionCount: number;
  // What a person should hear when the review did not do what it set out to; absent otherwise.
  readonly warning?: string;
}

// NOTE: Every host reports the review after generation through this, so a rewrite that timed out
// reads the same in the CLI's json, the desktop log and the extension's notice.
export function describeReviseOutcome(result: ReviseDraftWorkflowResult): ReviseOutcome {
  const { revisionCount } = result;
  const kept = revisionCount > 0 ? `재작성 ${revisionCount}회는 반영했습니다` : '초안은 생성된 그대로입니다';

  if (result.failure) {
    const stage = result.failure.stage === 'check' ? '검사' : '재작성';
    return {
      status: result.failure.kind === 'timeout' ? 'timeout' : 'failed',
      revisionCount,
      warning: `검수 ${stage}가 끝나지 않아 감수를 멈췄습니다. ${kept}: ${result.failure.message}`,
    };
  }

  if (result.rejection) {
    return {
      status: 'rejected',
      revisionCount,
      warning:
        `검수 재작성 결과가 안전 기준(${result.rejection.reason})을 통과하지 않아 원본을 유지했습니다 ` +
        `(${result.rejection.candidateLength}자 / 원본 ${result.rejection.originalLength}자).`,
    };
  }

  if (result.cancelled) {
    return { status: 'cancelled', revisionCount };
  }

  if (result.passed) {
    return { status: revisionCount > 0 ? 'applied' : 'passed', revisionCount };
  }

  return { status: revisionCount > 0 ? 'applied' : 'unresolved', revisionCount };
}

interface ReviseDraftContext {
  readonly loop: ReviseLoopContext;
  readonly draft: ReturnType<typeof parseDraft>;
}

// NOTE: 장면 좌표는 생성이 씬 캐시에 남긴 장부다(#108). 기록이 없으면(캐시 없는 작업본, 캐시를 두지
// 않는 호스트) 객체 비트의 좌표로 대신하고, 그것도 없으면 장면 안 연속성은 검수 기준에 들지 않는다.
async function loadSceneCoordinateLines(
  fs: IFileSystem,
  repository: ISceneCacheRepository | undefined,
  paths: StoryboardProjectPaths,
  scene: { readonly stem: string; readonly card?: { readonly beats?: readonly SceneBeat[] } },
  characters: readonly { readonly id: string; readonly name: string }[],
): Promise<string[]> {
  let recorded: readonly string[] | undefined;

  if (repository) {
    const cacheUri = sceneCacheFilePath(paths, scene.stem);
    // A record that cannot be read is no record: the cache never blocks a review.
    try {
      recorded = (await fs.exists(cacheUri))
        ? (await repository.read(cacheUri)).sceneCoordinates
        : undefined;
    } catch {
      recorded = undefined;
    }
  }

  const nameById = new Map(characters.map((character) => [character.id, character.name]));
  const coordinates =
    recorded ??
    listSceneCoordinates(
      sceneCoordinatesFromBeats(scene.card?.beats, (ref) => nameById.get(ref) ?? ref),
    );

  return coordinates.map((line) => `장면 좌표 ${line}`);
}

async function prepareReviseDraftContext(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  draftUri: StoryUri,
  sceneStem: string,
  sceneCacheRepository: ISceneCacheRepository | undefined,
): Promise<ReviseDraftContext> {
  const sceneFileName = `${sceneStem}.card`;
  const scene = await readSceneFile(
    joinUri(paths.sceneDirectory, sceneFileName),
    fs,
    sceneFileName,
  );
  const context = await buildSceneContext(sceneContextPaths(paths), scene, fs);
  const project = await readProjectIfPresent(fs, paths.projectJson);
  const setting = project?.setting;
  const { threadPaths, previousSceneOrder, narration } = await resolveReviseNarration(
    fs,
    paths,
    scene,
    project,
  );
  const narrative = await buildNarrativeContext(sceneContextPaths(threadPaths), context, fs, {
    ...(previousSceneOrder === undefined ? {} : { previousSceneOrder }),
    ...(narration?.knowledge === 'witnessed' && narration.focal
      ? { focalFilter: { focal: narration.focal } }
      : {}),
  });
  const canonFactLines = formatBibleFactLines(context, narrative.bibleFacts);
  // NOTE: 앞 씬이 확립한 사실·이미 공개된 정보와의 모순도 캐넌과 같은 기준으로 검사한다.
  const priorState = await readStoryState(threadPaths.storyState, fs);
  const factLines = [
    ...canonFactLines,
    ...storyStateFactLines(priorState, scene.order, scene.body),
    ...(await loadSceneCoordinateLines(fs, sceneCacheRepository, paths, scene, context.characters)),
  ];

  const draft = parseDraft(await readDraftFile(draftUri, fs));

  return {
    draft,
    loop: {
      format: draft.format,
      intent: scene.body,
      factLines,
      characterNames: context.characters.map((character) => character.name),
      characterCards: formatAugmentCards(context.characters, undefined),
      styleConstraints: setting?.styleConstraints ?? [],
      qualityCriteria: setting?.qualityCriteria ?? [],
      styleDirective: buildStyleDirective(
        setting,
        scene.frontmatter.relationStage,
        scene.frontmatter.targetWordCount,
        scene.body,
        narration,
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

  const aiService = new StoryboardAiService(options.aiProviderRegistry, {
    onUsage: (record): void => {
      void options.usageSink
        .record(options.workspaceUri, record)
        .catch((error: unknown) => options.logger.error('사용량 기록에 실패했습니다.', error));
    },
  });
  const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
  const ctx = await prepareReviseDraftContext(
    options.fileSystem,
    paths,
    draftUri,
    sceneStem,
    options.sceneCacheRepository,
  );

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
    ...(options.seedIssues === undefined ? {} : { seedIssues: options.seedIssues }),
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
    ...(result.failure === undefined ? {} : { failure: result.failure }),
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
