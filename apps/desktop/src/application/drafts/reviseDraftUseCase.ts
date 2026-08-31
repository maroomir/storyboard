import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { joinUri, type StoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import {
  buildNarrativeContext,
  buildSceneContext,
  createDraft,
  formatBibleFactLines,
  readStoryState,
  storyStateFactLines,
  parseDraft,
  readDraftFile,
  readSceneFile,
  writeDraftFile,
} from '@storyboard/story-format';
import type { ProjectSetting } from '@storyboard/story-format';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../../infrastructure/vscode/workspaceFsAdapters';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
import { buildStyleDirective, formatAugmentCards, StoryboardAIService } from '@storyboard/story-ai';
import type { AiProviderRegistry, UsageAttribution } from '@storyboard/story-ai';
import { recordUsageSafely } from '../../infrastructure/ai/recordUsageSafely';
import type { UsageRecorder } from '../../infrastructure/ai/UsageRecorder';
import {
  type DraftCandidateRejectionReason,
  resolveSceneTargetLength,
  runReviseLoop,
  type ReviseLoopContext,
} from '@storyboard/story-pipeline';

async function readContractGuidance(projectJsonUri: vscode.Uri): Promise<{
  styleConstraints: readonly string[];
  qualityCriteria: readonly string[];
  setting?: ProjectSetting;
}> {
  try {
    const project = await readProjectJson(projectJsonUri);
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
  readonly usageRecorder: UsageRecorder;
  readonly logger: StoryboardLogger;
  readonly generator: string;
}

export interface ReviseDraftRequest {
  readonly workspaceUri: vscode.Uri;
  readonly paths: StoryboardProjectPaths;
  readonly draftUri: vscode.Uri;
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
  paths: StoryboardProjectPaths,
  draftUri: vscode.Uri,
  sceneStem: string,
): Promise<ReviseDraftContext> {
  const sceneFileName = `${sceneStem}.card`;
  const scene = await readSceneFile(
    joinUri(paths.sceneDirectory, sceneFileName),
    vscodeFsAdapter,
    sceneFileName,
  );
  const ctxPaths = sceneContextPaths(paths);
  const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem);
  const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem);
  const canonFactLines = formatBibleFactLines(context, narrative.bibleFacts);
  // NOTE: 앞 씬이 확립한 사실·이미 공개된 정보와의 모순도 캐넌과 같은 기준으로 검사한다.
  const priorState = await readStoryState(paths.storyState, vscodeFsAdapter);
  const factLines = [...canonFactLines, ...storyStateFactLines(priorState, scene.order)];
  const { styleConstraints, qualityCriteria, setting } = await readContractGuidance(
    paths.projectJson,
  );

  const draft = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter));

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
      recordUsageSafely(options.usageRecorder, options.workspaceUri, record, options.logger);
    },
  });
  const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
  const ctx = await prepareReviseDraftContext(paths, draftUri, sceneStem);

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
    await writeDraftFile(
      draftUri,
      vscodeFsAdapter,
      createDraft({
        sceneStem,
        format: ctx.draft.format,
        body: result.body,
        // 생성 단계가 못 고치고 남긴 위반(사라진 대사·분량 미달 등)은 수정 루프가 다루는 문제와
        // 다르다. 여기서 빠뜨리면 헤더에서 사라져 읽는 사람이 영영 보지 못한다.
        warnings: ctx.draft.warnings,
        generator: options.generator,
        providerId: revisionConfig.providerId,
        model: revisionConfig.model,
      }),
    );
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

export class ReviseDraftUseCase {
  public constructor(private readonly dependencies: ReviseDraftUseCaseDependencies) {}

  public async execute(request: ReviseDraftRequest): Promise<ReviseDraftWorkflowResult> {
    return await runReviseDraftWorkflow({ ...this.dependencies, ...request });
  }
}
