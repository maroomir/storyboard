import {
  AiGateway,
  ApplyDraftFormatUseCase,
  ApplyStoryProposals,
  ApplyNoteAbsorbUseCase,
  ExportNotesUseCase,
  AssembleManuscriptUseCase,
  AugmentDraftUseCase,
  BibleCandidateRepository,
  BuildStoryCardsUseCase,
  CardCandidateRepository,
  CardCollectRepository,
  CardRecommendationRepository,
  CardSidebarRepository,
  CardWriterRepository,
  CheckDraftUseCase,
  CollectCardProposalsUseCase,
  CollectNotesUseCase,
  CompleteStoryScenesUseCase,
  CondenseDraftUseCase,
  CreateCardUseCase,
  CreateSceneUseCase,
  DraftRepository,
  ExpandDraftUseCase,
  ExportManuscriptUseCase,
  GenerateAllDraftsUseCase,
  GenerateDraftUseCase,
  GenerateOutlineUseCase,
  GenerateSceneBeatsUseCase,
  GenerateStoryStateUseCase,
  ManuscriptAssemblyRepository,
  NarratorCardRepository,
  NoteAbsorbRepository,
  NoteSourceProvider,
  NovelPipeline,
  NovelReviewRepository,
  NovelRunStateRepository,
  OutlineRepository,
  PlanNoteAbsorbUseCase,
  PostGenerationUpdateManager,
  ProjectRepository,
  PromoteBibleCandidatesUseCase,
  PromoteCardCandidatesUseCase,
  PromoteNoteCandidatesUseCase,
  RecommendCardsUseCase,
  RenameCardUseCase,
  ReviewManuscriptUseCase,
  ReviseAfterGenerateGate,
  ReviseDraftUseCase,
  RenameSceneUseCase,
  SaveDraftEditUseCase,
  SceneBatchRepository,
  SceneCacheRepository,
  SceneGroundingGapRepository,
  SceneRepository,
  SceneSeedRepository,
  SceneSidebarRepository,
  SeedScenesUseCase,
  StoryFeatureRepository,
  StudioChatUseCase,
  SummarizeChaptersUseCase,
  UpdateProjectContractUseCase,
  UsageMeter,
  type IFileSystem,
  type IStoryboardLogger,
  type IUsageSink,
  type IWorkspaceLocator,
  type NoteHttpFetch,
  type GenerateDraftUseCaseDependencies,
} from '@storyboard/story-engine';
import { type WorkspaceRunLockOwner } from '@storyboard/story-model';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
  type ConfigBridge,
  type SecretStore,
} from '@storyboard/story-ai';
import { CardManager } from './managers/cardManager';
import { DraftManager } from './managers/draftManager';
import { ManuscriptManager } from './managers/manuscriptManager';
import { NoteManager } from './managers/noteManager';
import { NovelManager } from './managers/novelManager';
import { StudioManager } from './managers/studioManager';
import { RunGate } from './runGate';
import { describeParameters, type ParameterReport } from './parameterRegistry';
import { loadResourceOverrides, type ResourceOverrideReport } from './resourceOverrides';
import { describeWorkspaceStatus, type WorkspaceStatus } from './workspaceStatus';
import type { StoryUri } from '@storyboard/story-model';

export interface StoryboardApplicationDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceLocator: IWorkspaceLocator;
  readonly logger: IStoryboardLogger;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly usageLedger?: IUsageSink;
  readonly resourceRoots?: readonly StoryUri[];
  readonly fetch?: NoteHttpFetch;
}

export interface StoryboardApplicationOptions {
  readonly generator: string;
  readonly lockOwner: WorkspaceRunLockOwner;
  readonly postGenerationUpdates?: boolean;
}

interface EngineGraph {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly usageMeter: UsageMeter;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
  readonly bibleCandidateRepository: BibleCandidateRepository;
  readonly cardSidebarRepository: CardSidebarRepository;
  readonly narratorCardRepository: NarratorCardRepository;
  readonly novelRunStateRepository: NovelRunStateRepository;
  readonly outlineRepository: OutlineRepository;
  readonly sceneSidebarRepository: SceneSidebarRepository;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly applyNoteAbsorbUseCase: ApplyNoteAbsorbUseCase;
  readonly exportNotesUseCase: ExportNotesUseCase;
  readonly applyStoryProposals: ApplyStoryProposals;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly checkDraftUseCase: CheckDraftUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly collectNotesUseCase: CollectNotesUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly createSceneUseCase: CreateSceneUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
  readonly generateStoryStateUseCase: GenerateStoryStateUseCase;
  readonly novelPipeline: NovelPipeline;
  readonly planNoteAbsorbUseCase: PlanNoteAbsorbUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly promoteNoteCandidatesUseCase: PromoteNoteCandidatesUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly renameCardUseCase: RenameCardUseCase;
  readonly renameSceneUseCase: RenameSceneUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly seedScenesUseCase: SeedScenesUseCase;
  readonly studioChatUseCase: StudioChatUseCase;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly updateProjectContractUseCase: UpdateProjectContractUseCase;
}

type DraftUseCaseSharedDependencies = Omit<
  GenerateDraftUseCaseDependencies,
  'postGenerationUpdates'
>;

export class StoryboardApplication {
  public readonly drafts: DraftManager;
  public readonly manuscript: ManuscriptManager;
  public readonly cards: CardManager;
  public readonly novel: NovelManager;
  public readonly studio: StudioManager;
  public readonly notes: NoteManager;
  public readonly runGate: RunGate;
  private readonly resourceRoots: readonly StoryUri[];
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
    const services: EngineGraph = buildServices(dependencies, options);

    this.drafts = new DraftManager(services);
    this.manuscript = new ManuscriptManager(services);
    this.cards = new CardManager(services);
    this.novel = new NovelManager(services);
    this.studio = new StudioManager(services);
    this.notes = new NoteManager(services);
    this.runGate = new RunGate({ fileSystem: dependencies.fileSystem, owner: options.lockOwner });
    this.resourceRoots = dependencies.resourceRoots ?? [];
    this.aiGateway = services.aiGateway;
    this.aiProviderRegistry = services.aiProviderRegistry;
    this.configBridge = services.configBridge;
    this.secretStore = services.secretStore;
    this.logger = services.logger;
    this.fileSystem = services.fileSystem;
    this.usageMeter = services.usageMeter;
    this.postGenerationUpdates = services.postGenerationUpdates;
  }

  public loadResourceOverrides(): Promise<ResourceOverrideReport> {
    return loadResourceOverrides(this.fileSystem, this.resourceRoots);
  }

  public async describeParameters(): Promise<ParameterReport> {
    const resources: ResourceOverrideReport = await this.loadResourceOverrides();

    return describeParameters({
      configBridge: this.configBridge,
      resources,
      roots: this.resourceRoots,
    });
  }

  public describeWorkspace(workspaceRoot: StoryUri): Promise<WorkspaceStatus> {
    return describeWorkspaceStatus({
      workspaceRoot,
      fileSystem: this.fileSystem,
      drafts: this.drafts,
      cards: this.cards,
      novel: this.novel,
    });
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

  const aiProviderRegistry: AiProviderRegistry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: true,
    onRiskWarning: (message) => logger.warn(message),
  });
  const usageMeter: UsageMeter = new UsageMeter();
  const usageSink: IUsageSink = usageMeter.wrap(
    recordUsageWithoutFailingPaidGeneration(dependencies.usageLedger, logger),
  );
  const aiGateway: AiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);
  const postGenerationUpdates: PostGenerationUpdateManager = new PostGenerationUpdateManager();

  const draftRepository: DraftRepository = new DraftRepository(fileSystem);
  const projectRepository: ProjectRepository = new ProjectRepository(fileSystem);
  const sceneRepository: SceneRepository = new SceneRepository(fileSystem);
  const sceneCacheRepository: SceneCacheRepository = new SceneCacheRepository(fileSystem);
  const sceneSeedRepository: SceneSeedRepository = new SceneSeedRepository(fileSystem);
  const sceneBatchRepository: SceneBatchRepository = new SceneBatchRepository(
    fileSystem,
    workspaceLocator,
  );
  const sceneSidebarRepository: SceneSidebarRepository = new SceneSidebarRepository(fileSystem);
  const outlineRepository: OutlineRepository = new OutlineRepository(fileSystem);
  const novelRunStateRepository: NovelRunStateRepository = new NovelRunStateRepository(fileSystem);
  const novelReviewRepository: NovelReviewRepository = new NovelReviewRepository(fileSystem);
  const manuscriptAssemblyRepository: ManuscriptAssemblyRepository =
    new ManuscriptAssemblyRepository(fileSystem);
  const cardWriterRepository: CardWriterRepository = new CardWriterRepository(fileSystem);
  const cardCandidateRepository: CardCandidateRepository = new CardCandidateRepository(
    fileSystem,
    logger,
  );
  const cardCollectRepository: CardCollectRepository = new CardCollectRepository(fileSystem);
  const cardRecommendationRepository: CardRecommendationRepository =
    new CardRecommendationRepository(fileSystem);
  const cardSidebarRepository: CardSidebarRepository = new CardSidebarRepository(fileSystem);
  const bibleCandidateRepository: BibleCandidateRepository = new BibleCandidateRepository(
    fileSystem,
  );
  const storyFeatureRepository: StoryFeatureRepository = new StoryFeatureRepository(fileSystem);
  const noteAbsorbRepository: NoteAbsorbRepository = new NoteAbsorbRepository(fileSystem);

  const assembleManuscriptUseCase: AssembleManuscriptUseCase = new AssembleManuscriptUseCase({
    logger,
    repository: manuscriptAssemblyRepository,
  });
  const summarizeChaptersUseCase: SummarizeChaptersUseCase = new SummarizeChaptersUseCase({
    aiGateway,
    logger,
    repository: manuscriptAssemblyRepository,
  });
  const draftUseCaseDependencies: DraftUseCaseSharedDependencies = {
    aiGateway,
    configBridge,
    draftRepository,
    fileSystem,
    generator,
    logger,
    projectRepository,
    sceneCacheRepository,
    sceneGroundingGapRepository: new SceneGroundingGapRepository(fileSystem),
    sceneRepository,
    workspaceLocator,
  };
  const generateDraftUseCase: GenerateDraftUseCase = new GenerateDraftUseCase({
    ...draftUseCaseDependencies,
    ...(options.postGenerationUpdates === false ? {} : { postGenerationUpdates }),
  });
  const reviseDraftUseCase: ReviseDraftUseCase = new ReviseDraftUseCase({
    aiProviderRegistry,
    usageSink,
    fileSystem,
    logger,
    generator,
    sceneCacheRepository,
  });
  const reviseAfterGenerateGate: ReviseAfterGenerateGate = new ReviseAfterGenerateGate({
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
    narratorCardRepository: new NarratorCardRepository(fileSystem),
    novelRunStateRepository,
    outlineRepository,
    sceneSidebarRepository,
    applyDraftFormatUseCase: new ApplyDraftFormatUseCase({
      fileSystem,
      aiGateway,
      logger,
      generator,
    }),
    applyNoteAbsorbUseCase: new ApplyNoteAbsorbUseCase({
      logger,
      noteRepository: noteAbsorbRepository,
      cardWriter: cardWriterRepository,
    }),
    exportNotesUseCase: new ExportNotesUseCase({
      logger,
      fileSystem,
      storyRepository: storyFeatureRepository,
      synopsis: outlineRepository,
    }),
    applyStoryProposals: new ApplyStoryProposals({ fileSystem }),
    assembleManuscriptUseCase,
    augmentDraftUseCase: new AugmentDraftUseCase({ fileSystem, aiGateway, logger, configBridge }),
    buildStoryCardsUseCase: new BuildStoryCardsUseCase({
      aiGateway,
      repository: storyFeatureRepository,
    }),
    checkDraftUseCase: new CheckDraftUseCase({ aiGateway, fileSystem, logger }),
    collectCardProposalsUseCase: new CollectCardProposalsUseCase({
      aiGateway,
      repository: cardCollectRepository,
    }),
    collectNotesUseCase: new CollectNotesUseCase({
      sources: new NoteSourceProvider({
        fileSystem,
        secretStore,
        fetch: dependencies.fetch ?? globalThis.fetch,
      }),
      repository: noteAbsorbRepository,
    }),
    completeStoryScenesUseCase: new CompleteStoryScenesUseCase({
      aiGateway,
      repository: storyFeatureRepository,
    }),
    condenseDraftUseCase: new CondenseDraftUseCase({ aiGateway, logger }),
    createCardUseCase: new CreateCardUseCase({ repository: cardWriterRepository }),
    createSceneUseCase: new CreateSceneUseCase({ fileSystem, logger }),
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
    generateStoryStateUseCase: new GenerateStoryStateUseCase(draftUseCaseDependencies),
    novelPipeline: new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      assembleManuscriptUseCase,
      cardWriter: cardWriterRepository,
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
    planNoteAbsorbUseCase: new PlanNoteAbsorbUseCase({
      aiGateway,
      logger,
      storyRepository: storyFeatureRepository,
      noteRepository: noteAbsorbRepository,
    }),
    promoteBibleCandidatesUseCase: new PromoteBibleCandidatesUseCase({
      repository: bibleCandidateRepository,
    }),
    promoteCardCandidatesUseCase: new PromoteCardCandidatesUseCase({
      repository: cardCandidateRepository,
    }),
    promoteNoteCandidatesUseCase: new PromoteNoteCandidatesUseCase({
      logger,
      noteRepository: noteAbsorbRepository,
      cardWriter: cardWriterRepository,
    }),
    recommendCardsUseCase: new RecommendCardsUseCase({
      aiGateway,
      logger,
      repository: cardRecommendationRepository,
    }),
    renameCardUseCase: new RenameCardUseCase({ fileSystem, logger }),
    renameSceneUseCase: new RenameSceneUseCase({ fileSystem, logger }),
    reviewManuscriptUseCase: new ReviewManuscriptUseCase({
      aiGateway,
      logger,
      repository: manuscriptAssemblyRepository,
    }),
    reviseAfterGenerateGate,
    reviseDraftUseCase,
    saveDraftEditUseCase: new SaveDraftEditUseCase({ fileSystem }),
    seedScenesUseCase: new SeedScenesUseCase({ fileSystem, logger, sceneSeedRepository }),
    studioChatUseCase: new StudioChatUseCase({ aiGateway, logger }),
    summarizeChaptersUseCase,
    updateProjectContractUseCase: new UpdateProjectContractUseCase({ fileSystem, logger }),
  };
}

function recordUsageWithoutFailingPaidGeneration(
  ledger: IUsageSink | undefined,
  logger: IStoryboardLogger,
): IUsageSink {
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
