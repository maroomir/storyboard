import {
  DraftRepository,
  GenerateDraftUseCase,
  ReviseDraftUseCase,
  NodeUri,
  draftPath,
  getStoryboardProjectPaths,
  scenePath,
  type StoryUri,
  type StoryboardLogger,
  type UsageSink,
} from '@storyboard/story-engine';
import { AiGateway } from '@storyboard/story-engine';
import type { AiProviderRegistry, ConfigBridge, OnUsageRecordCallback } from '@storyboard/story-ai';

import type { ContentService } from '../content/contentService';
import type { MutateOutcome } from '../workspace/workspaceChanges';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import {
  BotFileSystem,
  BotProjectRepository,
  BotSceneCacheRepository,
  BotSceneRepository,
  BotWorkspaceLocator,
} from './engineAdapters';
import type { DraftGenerationOutcome, DraftGenerator } from './draftPipeline';
import type { DraftReviser, DraftRevisionReport } from './reviewPipeline';

export interface SceneDraftGeneratorOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly registry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly autoGrounding: boolean;
  readonly generator: string;
  // Every provider call this generator makes must land in the running job's ledger. The engine
  // builds its own AI service per use case, so the callback has to reach it through this port —
  // the app's shared service is not the one doing the work here.
  readonly onUsage: OnUsageRecordCallback;
  readonly onStage?: (stage: string, current: number, total: number) => void;
}

// Runs the extension's use cases, not a copy of them. Everything specific to the bot lives in the
// adapters this class injects: drafts and cache go through ContentService, grounding rides the
// mutate gate with the read-time hash as its baseline.
export class SceneDraftGenerator implements DraftGenerator, DraftReviser {
  public constructor(private readonly options: SceneDraftGeneratorOptions) {}

  public async generate(
    sceneStem: string,
    isCancelled: () => boolean,
  ): Promise<DraftGenerationOutcome> {
    const engine = this.createEngine();
    const result = await engine.generateDraft.execute(engine.sceneUri(sceneStem), {
      force: true,
      shouldCancel: isCancelled,
      suppressLoggerPanel: true,
      // Queued work cannot stop to ask Telegram, so `draft.autoGrounding` decides once: fill and
      // commit, or leave the scene exactly as authored.
      skipSceneGrounding: !this.options.autoGrounding,
      onPipelineProgress: (stage, current, total) =>
        this.options.onStage?.(String(stage), current, total),
    });

    if (!result.ok) {
      return result.kind === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'failed', errorMessage: result.message };
    }

    if (isCancelled()) {
      return { status: 'cancelled' };
    }

    if (this.options.configBridge.isReviseAfterGenerateEnabled()) {
      await this.runRevise(engine, sceneStem, isCancelled);
    }

    return { status: 'written', outcome: engine.fileSystem.takeDraftOutcome() };
  }

  // The /review command: the same loop over the draft that already exists, without regenerating it.
  public async revise(
    sceneStem: string,
    _draftText: string,
    isCancelled: () => boolean,
  ): Promise<DraftRevisionReport> {
    const engine = this.createEngine();
    const result = await this.runRevise(engine, sceneStem, isCancelled);

    return {
      passed: result?.passed ?? true,
      preservedOriginal: result?.preservedOriginal === true,
      revisionCount: result?.revisionCount ?? 0,
      remainingBlocking: result?.remainingBlocking ?? 0,
      cancelled: result?.cancelled ?? false,
      outcome: engine.fileSystem.takeDraftOutcome(),
    };
  }

  private async runRevise(
    engine: BotEngine,
    sceneStem: string,
    isCancelled: () => boolean,
  ): Promise<Awaited<ReturnType<ReviseDraftUseCase['execute']>> | undefined> {
    const { configBridge } = this.options;
    const workspaceUri = engine.workspaceRoot;

    return await engine.revise.execute({
      workspaceUri,
      paths: getStoryboardProjectPaths(workspaceUri),
      draftUri: draftPath(workspaceUri, sceneStem),
      sceneStem,
      maxIterations: configBridge.getReviseMaxIterations(),
      maxCompressionPercent: configBridge.getMaxCompressionPercent(),
      reviseScoreThreshold: configBridge.getReviseScoreThreshold(),
      shouldCancel: isCancelled,
      onProgress: (message) => this.options.onStage?.(message, 0, 0),
    });
  }

  private createEngine(): BotEngine {
    const { store, content, registry, configBridge, generator } = this.options;
    const workspaceRoot = NodeUri.file(store.root);
    const fileSystem = new BotFileSystem(content, workspaceRoot);
    const logger = createStageLogger(this.options.onStage);
    const usageSink: UsageSink = {
      record: async (_workspaceRoot, usage): Promise<void> => {
        this.options.onUsage(usage);
      },
    };
    const aiGateway = new AiGateway(registry, usageSink, logger);

    return {
      workspaceRoot,
      fileSystem,
      sceneUri: (sceneStem) => scenePath(workspaceRoot, sceneStem),
      // NOTE: no `postGenerationUpdates`. Those updaters write tracked `character/`/`background/`
      // cards through the file system port, which would bypass the mutate gate — no commit, no
      // freshness guard. The bot must not carry that capability until a tracked-write port exists.
      generateDraft: new GenerateDraftUseCase({
        aiGateway,
        configBridge,
        draftRepository: new DraftRepository(fileSystem),
        fileSystem,
        generator,
        logger,
        projectRepository: new BotProjectRepository(store),
        sceneCacheRepository: new BotSceneCacheRepository(fileSystem),
        sceneRepository: new BotSceneRepository(store, content, () =>
          this.options.onStage?.('사실 시트 저장 건너뜀 (동시 편집 감지)', 0, 0),
        ),
        workspaceLocator: new BotWorkspaceLocator(store.root),
      }),
      revise: new ReviseDraftUseCase({
        aiProviderRegistry: registry,
        usageSink,
        fileSystem,
        logger,
        generator,
        sceneCacheRepository: new BotSceneCacheRepository(fileSystem),
      }),
    };
  }
}

interface BotEngine {
  readonly workspaceRoot: StoryUri;
  readonly fileSystem: BotFileSystem;
  readonly sceneUri: (sceneStem: string) => StoryUri;
  readonly generateDraft: GenerateDraftUseCase;
  readonly revise: ReviseDraftUseCase;
}

// The engine logs progress; the bot turns it into a Telegram stage line.
function createStageLogger(
  onStage: ((stage: string, current: number, total: number) => void) | undefined,
): StoryboardLogger {
  return {
    info: (message) => onStage?.(message, 0, 0),
    warn: (message) => onStage?.(message, 0, 0),
    error: (message) => onStage?.(message, 0, 0),
    show: () => undefined,
  };
}

export type { MutateOutcome };
