import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  StoryUri,
  NarrationDirective,
  StoryboardProject,
  UsageAttribution,
  SceneFile,
  SceneContext,
  NarrativeContext,
  StoryState,
  Draft,
  SceneCacheRecord,
  ProjectSetting,
} from '@storyboard/story-model';
import {
  sceneContextPaths,
  joinUri,
  type StoryboardProjectPaths,
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
import {
  SceneNarrationResolver,
  type ChapterNarrationDefaults,
  type SceneThreadContext,
} from './sceneNarrationResolver';
import { formatAugmentCards, StoryboardAiService } from '@storyboard/story-ai';
import type { TaskAiConfigResolved } from '@storyboard/story-ai';
import { type DraftCandidateRejectionReason } from '#engine/pipeline/draftCandidateValidation';
import { listSceneCoordinates, sceneCoordinatesFromBeats } from '#engine/pipeline/sceneCoordinates';
import { RevisionPlanRecorder } from '#engine/persistence/revisionPlanRecorder';
import {
  ReviseLoop,
  describeReviseRound,
  type ReviseLoopContext,
  type ReviseLoopFailure,
  type ReviseLoopResult,
  type ReviseRound,
  type ReviseSeedIssues,
} from '#engine/pipeline/reviseLoop';

async function readProjectIfPresent(
  fs: IFileSystem,
  projectJsonUri: StoryUri,
): Promise<StoryboardProject | undefined> {
  try {
    return await new ProjectRepository(fs).read(projectJsonUri);
  } catch {
    return undefined;
  }
}

interface ReviseNarration {
  readonly threadPaths: StoryboardProjectPaths;
  readonly previousSceneOrder: number | undefined;
  readonly narration: NarrationDirective | undefined;
}

async function resolveReviseNarration(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  scene: Awaited<ReturnType<typeof readSceneFile>>,
  project: StoryboardProject | undefined,
): Promise<ReviseNarration> {
  if (project === undefined) {
    return {
      threadPaths: paths,
      previousSceneOrder: undefined,
      narration: resolveNarration({ focalFallback: scene.frontmatter.povCharacter }),
    };
  }

  const resolver: SceneNarrationResolver = new SceneNarrationResolver(fs);
  const chapterDefaults: ChapterNarrationDefaults = await resolver.readChapterDefaults(
    paths,
    scene.order,
  );
  const thread: SceneThreadContext = await resolver.resolveThread(
    paths,
    scene,
    project,
    chapterDefaults.thread,
  );
  const narration: NarrationDirective | undefined = await resolver.resolveNarration(
    paths,
    scene,
    project,
    chapterDefaults,
  );

  return {
    threadPaths: thread.threadPaths,
    previousSceneOrder: thread.previousSceneOrder,
    narration,
  };
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
  readonly rounds: readonly ReviseRound[];
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
  readonly warning?: string;
}

export function describeReviseOutcome(reviseResult: ReviseDraftWorkflowResult): ReviseOutcome {
  const { revisionCount } = reviseResult;
  const kept: string =
    revisionCount > 0 ? `재작성 ${revisionCount}회는 반영했습니다` : '초안은 생성된 그대로입니다';

  if (reviseResult.failure) {
    const stage: '검사' | '재작성' = reviseResult.failure.stage === 'check' ? '검사' : '재작성';
    return {
      status: reviseResult.failure.kind === 'timeout' ? 'timeout' : 'failed',
      revisionCount,
      warning: `검수 ${stage}가 끝나지 않아 감수를 멈췄습니다. ${kept}: ${reviseResult.failure.message}`,
    };
  }

  if (reviseResult.rejection) {
    return {
      status: 'rejected',
      revisionCount,
      warning:
        `검수 재작성 결과가 안전 기준(${reviseResult.rejection.reason})을 통과하지 않아 원본을 유지했습니다 ` +
        `(${reviseResult.rejection.candidateLength}자 / 원본 ${reviseResult.rejection.originalLength}자).`,
    };
  }

  if (reviseResult.cancelled) {
    return { status: 'cancelled', revisionCount };
  }

  if (reviseResult.passed) {
    return { status: revisionCount > 0 ? 'applied' : 'passed', revisionCount };
  }

  return { status: revisionCount > 0 ? 'applied' : 'unresolved', revisionCount };
}

interface ReviseDraftContext {
  readonly loop: ReviseLoopContext;
  readonly draft: ReturnType<typeof parseDraft>;
}

async function loadSceneCoordinateLines(
  fs: IFileSystem,
  repository: ISceneCacheRepository | undefined,
  paths: StoryboardProjectPaths,
  scene: { readonly stem: string; readonly card?: { readonly beats?: readonly SceneBeat[] } },
  characters: readonly { readonly id: string; readonly name: string }[],
): Promise<string[]> {
  let recorded: readonly string[] | undefined;

  if (repository) {
    const cacheUri: StoryUri = sceneCacheFilePath(paths, scene.stem);
    try {
      recorded = (await fs.exists(cacheUri))
        ? (await repository.read(cacheUri)).sceneCoordinates
        : undefined;
    } catch {
      recorded = undefined;
    }
  }

  const nameById: Map<string, string> = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const coordinates: readonly string[] =
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
  const sceneFileName: string = `${sceneStem}.card`;
  const scene: SceneFile = await readSceneFile(
    joinUri(paths.sceneDirectory, sceneFileName),
    fs,
    sceneFileName,
  );
  const context: SceneContext = await new SceneContextReader(fs).build(
    sceneContextPaths(paths),
    scene,
  );
  const project: StoryboardProject | undefined = await readProjectIfPresent(fs, paths.projectJson);
  const setting: ProjectSetting | undefined = project?.setting;
  const { threadPaths, previousSceneOrder, narration } = await resolveReviseNarration(
    fs,
    paths,
    scene,
    project,
  );
  const narrative: NarrativeContext = await new SceneContextReader(fs).buildNarrative(
    sceneContextPaths(threadPaths),
    context,
    {
      ...(previousSceneOrder === undefined ? {} : { previousSceneOrder }),
      ...(narration?.knowledge === 'witnessed' && narration.focal
        ? { focalFilter: { focal: narration.focal } }
        : {}),
    },
  );
  const canonFactLines: string[] = formatBibleFactLines(context, narrative.bibleFacts);
  const priorState: StoryState = await readStoryState(threadPaths.storyState, fs);
  const factLines: string[] = [
    ...canonFactLines,
    ...storyStateFactLines(priorState, scene.order, scene.body),
    ...(await loadSceneCoordinateLines(fs, sceneCacheRepository, paths, scene, context.characters)),
  ];

  const draft: Draft = parseDraft(await readDraftFile(draftUri, fs));

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
export class ReviseDraftUseCase {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: ReviseDraftRequest): Promise<ReviseDraftWorkflowResult> {
    return await this.runReviseDraftWorkflow(request);
  }

  private async runReviseDraftWorkflow(
    request: ReviseDraftRequest,
  ): Promise<ReviseDraftWorkflowResult> {
    const {
      paths,
      draftUri,
      sceneStem,
      maxIterations,
      reviseScoreThreshold,
      maxCompressionPercent,
    } = request;

    const aiService: StoryboardAiService = new StoryboardAiService(this.ai.providerRegistry, {
      onUsage: (record): void => {
        void this.ai.usageSink
          .record(request.workspaceUri, record)
          .catch((error: unknown) => this.host.logger.error('사용량 기록에 실패했습니다.', error));
      },
    });
    const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
    const reviseContext: ReviseDraftContext = await prepareReviseDraftContext(
      this.host.fileSystem,
      paths,
      draftUri,
      sceneStem,
      this.repositories.sceneCache,
    );

    const loopResult: ReviseLoopResult = await new ReviseLoop({
      aiService,
      registry: this.ai.providerRegistry,
      attribution,
      loopContext: reviseContext.loop,
      body: reviseContext.draft.body,
      maxIterations,
      reviseScoreThreshold,
      maxCompressionPercent,
      onProgress: request.onProgress,
      shouldCancel: request.shouldCancel,
      ...(request.seedIssues === undefined ? {} : { seedIssues: request.seedIssues }),
      onRound: (round) => this.host.logger.info(`${sceneStem}: ${describeReviseRound(round)}`),
    }).run();

    try {
      await new RevisionPlanRecorder(this.host.fileSystem).recordRounds(
        paths,
        sceneStem,
        loopResult.rounds,
      );
    } catch (error) {
      this.host.logger.warn(`감수 회차 기록을 남기지 못했습니다: ${String(error)}`);
    }

    if (loopResult.revisionCount > 0 && !loopResult.rejection && !loopResult.cancelled) {
      const revisionConfig: TaskAiConfigResolved =
        this.ai.providerRegistry.getTaskAiConfig('draftRevision');
      const revised: Draft = createDraft({
        sceneStem,
        format: reviseContext.draft.format,
        body: loopResult.body,
        warnings: reviseContext.draft.warnings,
        generator: this.host.generator,
        providerId: revisionConfig.providerId,
        model: revisionConfig.model,
      });

      await writeDraftFile(draftUri, this.host.fileSystem, revised);
      await this.refreshSceneCacheBodyHash(paths, sceneStem, revised);
    }

    return {
      passed: loopResult.passed,
      revisionCount: loopResult.revisionCount,
      remainingBlocking: loopResult.remainingBlocking,
      cancelled: loopResult.cancelled,
      instructions: loopResult.instructions,
      preservedOriginal: loopResult.preservedOriginal,
      rejection: loopResult.rejection,
      ...(loopResult.failure === undefined ? {} : { failure: loopResult.failure }),
      rounds: loopResult.rounds,
    };
  }

  private async refreshSceneCacheBodyHash(
    paths: StoryboardProjectPaths,
    sceneStem: string,
    revised: ReturnType<typeof createDraft>,
  ): Promise<void> {
    const repository: ISceneCacheRepository | undefined = this.repositories.sceneCache;

    if (!repository) {
      return;
    }

    const cacheUri: StoryUri = sceneCacheFilePath(paths, sceneStem);

    try {
      const record: SceneCacheRecord = await repository.read(cacheUri);
      await repository.write(cacheUri, {
        ...record,
        bodyHash: computeDraftBodyHash(parseDraft(serializeDraft(revised)).body),
      });
    } catch (error) {
      this.host.logger.warn(`씬 캐시의 본문 해시를 갱신하지 못했습니다: ${String(error)}`);
    }
  }
}
