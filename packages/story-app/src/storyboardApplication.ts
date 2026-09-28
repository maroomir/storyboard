import {
  AiGateway,
  ApplyDraftFormatUseCase,
  AssembleManuscriptUseCase,
  AugmentDraftUseCase,
  BibleCandidateRepository,
  BuildStoryCardsUseCase,
  CardCandidateRepository,
  CardCollectRepository,
  CardRecommendationRepository,
  CardSidebarRepository,
  CardWriterRepository,
  CollectCardProposalsUseCase,
  CompleteStoryScenesUseCase,
  CondenseDraftUseCase,
  CreateCardUseCase,
  DraftRepository,
  ExpandDraftUseCase,
  ExportManuscriptUseCase,
  GenerateAllDraftsUseCase,
  GenerateDraftUseCase,
  GenerateOutlineUseCase,
  GenerateSceneBeatsUseCase,
  ManuscriptAssemblyRepository,
  NovelPipeline,
  NovelReviewRepository,
  NovelRunStateRepository,
  OutlineRepository,
  PostGenerationUpdateManager,
  ProjectRepository,
  PromoteBibleCandidatesUseCase,
  PromoteCardCandidatesUseCase,
  RecommendCardsUseCase,
  ReviewManuscriptUseCase,
  ReviseAfterGenerateGate,
  ReviseDraftUseCase,
  SaveDraftEditUseCase,
  SceneBatchRepository,
  SceneCacheRepository,
  SceneRepository,
  SceneSeedRepository,
  SceneSidebarRepository,
  StoryFeatureRepository,
  StudioChatUseCase,
  SummarizeChaptersUseCase,
  UsageMeter,
  type IFileSystem,
  type IStoryboardLogger,
  type IUsageSink,
  type IWorkspaceLocator,
} from '@storyboard/story-engine';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
  type ConfigBridge,
  type SecretStore,
} from '@storyboard/story-ai';
import { CardManager } from './managers/cardManager';
import { DraftManager } from './managers/draftManager';
import { ManuscriptManager } from './managers/manuscriptManager';
import { NovelManager } from './managers/novelManager';
import { StudioManager } from './managers/studioManager';

// What a host must supply before the engine can run: the six adapters that differ between the
// extension, the CLI and the desktop app. Everything else is built here, once, the same way.
export interface StoryboardApplicationDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceLocator: IWorkspaceLocator;
  readonly logger: IStoryboardLogger;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  // Where a paid call's token cost is persisted. A host without a usage panel leaves it out and
  // only the per-run meter sees the cost.
  readonly usageLedger?: IUsageSink;
}

export interface StoryboardApplicationOptions {
  // Stamped into every file the engine writes, so a draft says which app and version produced it.
  readonly generator: string;
  // Post-generation card updates rewrite the workspace's cards in unawaited background jobs. A
  // measurement run must leave its fixture byte-identical, so it turns them off.
  readonly postGenerationUpdates?: boolean;
}

interface EngineGraph {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  // What a run has spent so far, for the per-run budget. Every AI call passes through it.
  readonly usageMeter: UsageMeter;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
  readonly bibleCandidateRepository: BibleCandidateRepository;
  readonly cardSidebarRepository: CardSidebarRepository;
  readonly novelRunStateRepository: NovelRunStateRepository;
  readonly outlineRepository: OutlineRepository;
  readonly sceneSidebarRepository: SceneSidebarRepository;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
  readonly novelPipeline: NovelPipeline;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly studioChatUseCase: StudioChatUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
}

// The one place the engine's object graph is assembled. Each app builds its adapters, hands them
// in, and drives the engine through the managers; none of them wires a use case on its own.
export class StoryboardApplication {
  public readonly drafts: DraftManager;
  public readonly manuscript: ManuscriptManager;
  public readonly cards: CardManager;
  public readonly novel: NovelManager;
  public readonly studio: StudioManager;
  public readonly aiGateway: AiGateway;
  public readonly aiProviderRegistry: AiProviderRegistry;
  public readonly configBridge: ConfigBridge;
  public readonly secretStore: SecretStore;
  public readonly logger: IStoryboardLogger;
  public readonly fileSystem: IFileSystem;
  public readonly usageMeter: UsageMeter;
  public readonly postGenerationUpdates: PostGenerationUpdateManager;
  public constructor(
    dependencies: StoryboardApplicationDependencies,
    options: StoryboardApplicationOptions,
  ) {
    const services = buildServices(dependencies, options);

    this.drafts = new DraftManager(services);
    this.manuscript = new ManuscriptManager(services);
    this.cards = new CardManager(services);
    this.novel = new NovelManager(services);
    this.studio = new StudioManager(services);
    this.aiGateway = services.aiGateway;
    this.aiProviderRegistry = services.aiProviderRegistry;
    this.configBridge = services.configBridge;
    this.secretStore = services.secretStore;
    this.logger = services.logger;
    this.fileSystem = services.fileSystem;
    this.usageMeter = services.usageMeter;
    this.postGenerationUpdates = services.postGenerationUpdates;
  }

  public dispose(): void {
    this.postGenerationUpdates.dispose();
  }
}

function buildServices(
  dependencies: StoryboardApplicationDependencies,
  options: StoryboardApplicationOptions,
): EngineGraph {
  const { fileSystem, workspaceLocator, logger, secretStore, configBridge } = dependencies;
  const { generator } = options;

  const aiProviderRegistry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: true,
  });
  const usageMeter = new UsageMeter();
  const usageSink = usageMeter.wrap(guardUsageLedger(dependencies.usageLedger, logger));
  const aiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);
  const postGenerationUpdates = new PostGenerationUpdateManager();

  const draftRepository = new DraftRepository(fileSystem);
  const projectRepository = new ProjectRepository(fileSystem);
  const sceneRepository = new SceneRepository(fileSystem);
  const sceneCacheRepository = new SceneCacheRepository(fileSystem);
  const sceneSeedRepository = new SceneSeedRepository(fileSystem);
  const sceneBatchRepository = new SceneBatchRepository(fileSystem, workspaceLocator);
  const sceneSidebarRepository = new SceneSidebarRepository(fileSystem);
  const outlineRepository = new OutlineRepository(fileSystem);
  const novelRunStateRepository = new NovelRunStateRepository(fileSystem);
  const novelReviewRepository = new NovelReviewRepository(fileSystem);
  const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository(fileSystem);
  const cardWriterRepository = new CardWriterRepository(fileSystem);
  const cardCandidateRepository = new CardCandidateRepository(fileSystem, logger);
  const cardCollectRepository = new CardCollectRepository(fileSystem);
  const cardRecommendationRepository = new CardRecommendationRepository(fileSystem);
  const cardSidebarRepository = new CardSidebarRepository(fileSystem);
  const bibleCandidateRepository = new BibleCandidateRepository(fileSystem);
  const storyFeatureRepository = new StoryFeatureRepository(fileSystem);

  const assembleManuscriptUseCase = new AssembleManuscriptUseCase({
    logger,
    repository: manuscriptAssemblyRepository,
  });
  const summarizeChaptersUseCase = new SummarizeChaptersUseCase({
    aiGateway,
    logger,
    repository: manuscriptAssemblyRepository,
  });
  const generateDraftUseCase = new GenerateDraftUseCase({
    aiGateway,
    configBridge,
    draftRepository,
    fileSystem,
    generator,
    logger,
    ...(options.postGenerationUpdates === false ? {} : { postGenerationUpdates }),
    projectRepository,
    sceneCacheRepository,
    sceneRepository,
    workspaceLocator,
  });
  const reviseDraftUseCase = new ReviseDraftUseCase({
    aiProviderRegistry,
    usageSink,
    fileSystem,
    logger,
    generator,
    sceneCacheRepository,
  });
  const reviseAfterGenerateGate = new ReviseAfterGenerateGate({
    fileSystem,
    workspaceLocator,
    configBridge,
    logger,
    reviseDraftUseCase,
  });

  return {
    aiGateway,
    aiProviderRegistry,
    configBridge,
    secretStore,
    fileSystem,
    logger,
    usageMeter,
    postGenerationUpdates,
    bibleCandidateRepository,
    cardSidebarRepository,
    novelRunStateRepository,
    outlineRepository,
    sceneSidebarRepository,
    applyDraftFormatUseCase: new ApplyDraftFormatUseCase({
      fileSystem,
      aiGateway,
      logger,
      generator,
    }),
    assembleManuscriptUseCase,
    augmentDraftUseCase: new AugmentDraftUseCase({ fileSystem, aiGateway, logger, configBridge }),
    buildStoryCardsUseCase: new BuildStoryCardsUseCase({
      aiGateway,
      repository: storyFeatureRepository,
    }),
    collectCardProposalsUseCase: new CollectCardProposalsUseCase({
      aiGateway,
      repository: cardCollectRepository,
    }),
    completeStoryScenesUseCase: new CompleteStoryScenesUseCase({
      aiGateway,
      repository: storyFeatureRepository,
    }),
    condenseDraftUseCase: new CondenseDraftUseCase({ aiGateway, logger }),
    createCardUseCase: new CreateCardUseCase({ repository: cardWriterRepository }),
    expandDraftUseCase: new ExpandDraftUseCase({ aiGateway, logger }),
    exportManuscriptUseCase: new ExportManuscriptUseCase({
      repository: manuscriptAssemblyRepository,
    }),
    generateAllDraftsUseCase: new GenerateAllDraftsUseCase({
      generateDraftUseCase,
      logger,
      reviseAfterGenerateGate,
      sceneRepository: sceneBatchRepository,
    }),
    generateDraftUseCase,
    generateOutlineUseCase: new GenerateOutlineUseCase({
      aiGateway,
      logger,
      repository: outlineRepository,
    }),
    generateSceneBeatsUseCase: new GenerateSceneBeatsUseCase({
      aiGateway,
      configBridge,
      fileSystem,
      logger,
      sceneRepository,
    }),
    novelPipeline: new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      assembleManuscriptUseCase,
      configBridge,
      generateDraftUseCase,
      logger,
      novelReviewRepository,
      novelRunStateRepository,
      outlineRepository,
      reviseDraftUseCase,
      sceneSeedRepository,
      summarizeChaptersUseCase,
      usageSink,
      fileSystem,
    }),
    promoteBibleCandidatesUseCase: new PromoteBibleCandidatesUseCase({
      repository: bibleCandidateRepository,
    }),
    promoteCardCandidatesUseCase: new PromoteCardCandidatesUseCase({
      repository: cardCandidateRepository,
    }),
    recommendCardsUseCase: new RecommendCardsUseCase({
      aiGateway,
      logger,
      repository: cardRecommendationRepository,
    }),
    reviewManuscriptUseCase: new ReviewManuscriptUseCase({
      aiGateway,
      logger,
      repository: manuscriptAssemblyRepository,
    }),
    reviseAfterGenerateGate,
    reviseDraftUseCase,
    saveDraftEditUseCase: new SaveDraftEditUseCase({ fileSystem }),
    studioChatUseCase: new StudioChatUseCase({ aiGateway, logger }),
    summarizeChaptersUseCase,
  };
}

// NOTE: accounting must never fail a generation the author already paid for, so a ledger write that
// throws is logged and swallowed here rather than surfacing to the pipeline.
function guardUsageLedger(ledger: IUsageSink | undefined, logger: IStoryboardLogger): IUsageSink {
  if (!ledger) {
    return { record: async (): Promise<void> => undefined };
  }

  return {
    record: async (workspaceRoot, usage): Promise<void> => {
      try {
        await ledger.record(workspaceRoot, usage);
      } catch (error) {
        logger.error('사용량 기록에 실패했습니다.', error);
      }
    },
  };
}
