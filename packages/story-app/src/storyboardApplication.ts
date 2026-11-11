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
  ProjectRepository,
  PromoteBibleCandidatesUseCase,
  PromoteNoteCandidatesUseCase,
  RecommendCardsUseCase,
  RenameCardUseCase,
  ReviewManuscriptUseCase,
  RevisionPlanRecorder,
  ReviseAfterGenerateGate,
  DraftHistoryArchiver,
  ReviseDraftUseCase,
  RenameSceneUseCase,
  SaveDraftEditUseCase,
  SceneBatchRepository,
  SceneCacheRepository,
  SceneRepository,
  SceneSeedRepository,
  SceneSidebarRepository,
  SeedScenesUseCase,
  StoryFeatureRepository,
  StudioChatUseCase,
  StudioContextRepository,
  StudioSessionRepository,
  StudioFollowUpRepository,
  SummarizeChaptersUseCase,
  UpdateProjectContractUseCase,
  UsageLedgerRecorder,
  UsageMeter,
  WorkspaceCaches,
  WorkspaceCards,
  WorkspaceRunLocks,
  WorkspaceScenes,
  type IFileSystem,
  type ISqlDatabaseHost,
  type IStoryboardLogger,
  type IUsageSink,
  type IWorkspaceLocator,
  type NoteHttpFetch,
  type HostAdapters,
  type AiServices,
  type WorkspaceRepositories,
  type IBibleCandidateRepository,
  type ICardSidebarRepository,
  type INarratorCardRepository,
  type INovelRunStateRepository,
  type ISceneSidebarRepository,
  InterviewSessionUseCase,
  DescribeInterviewCoverageUseCase,
  InterviewRepository,
} from '@storyboard/story-engine';
import { type WorkspaceRunLockOwner } from '@storyboard/story-model';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
  type ConfigBridge,
  type SecretStore,
} from '@storyboard/story-ai';
import { CardManager } from '#app/managers/cardManager';
import { DraftManager } from '#app/managers/draftManager';
import { ManuscriptManager } from '#app/managers/manuscriptManager';
import { NoteManager } from '#app/managers/noteManager';
import { InterviewManager } from '#app/managers/interviewManager';
import { ProjectManager } from '#app/managers/projectManager';
import { WorkspaceManager } from '#app/managers/workspaceManager';
import { NovelManager } from '#app/managers/novelManager';
import { StudioManager } from '#app/managers/studioManager';
import { RunGate } from '#app/runGate';
import { describeParameters, type ParameterReport } from '#app/parameterRegistry';
import { loadResourceOverrides, type ResourceOverrideReport } from '#app/resourceOverrides';
import { describeWorkspaceStatus, type WorkspaceStatus } from '#app/workspaceStatus';
import type { StoryUri } from '@storyboard/story-model';

export interface StoryboardApplicationDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceLocator: IWorkspaceLocator;
  readonly logger: IStoryboardLogger;
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly sqlDatabaseHost: ISqlDatabaseHost;
  readonly usageObserver?: IUsageSink;
  readonly resourceRoots?: readonly StoryUri[];
  readonly fetch?: NoteHttpFetch;
}

export interface StoryboardApplicationOptions {
  readonly generator: string;
  readonly lockOwner: WorkspaceRunLockOwner;
}

interface EngineGraph {
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly runLocks: WorkspaceRunLocks;
  readonly usageLedger: UsageLedgerRecorder;
  readonly usageMeter: UsageMeter;
  readonly bibleCandidateRepository: IBibleCandidateRepository;
  readonly cardSidebarRepository: ICardSidebarRepository;
  readonly narratorCardRepository: INarratorCardRepository;
  readonly novelRunStateRepository: INovelRunStateRepository;
  readonly sceneSidebarRepository: ISceneSidebarRepository;
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
  readonly interviewSessionUseCase: InterviewSessionUseCase;
  readonly describeInterviewCoverageUseCase: DescribeInterviewCoverageUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly promoteNoteCandidatesUseCase: PromoteNoteCandidatesUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly renameCardUseCase: RenameCardUseCase;
  readonly renameSceneUseCase: RenameSceneUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly revisionPlanRecorder: RevisionPlanRecorder;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly draftHistoryArchiver: DraftHistoryArchiver;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly seedScenesUseCase: SeedScenesUseCase;
  readonly studioChatUseCase: StudioChatUseCase;
  readonly studioContextRepository: StudioContextRepository;
  readonly studioSessionRepository: StudioSessionRepository;
  readonly studioFollowUpRepository: StudioFollowUpRepository;
  readonly cardCollectRepository: CardCollectRepository;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly updateProjectContractUseCase: UpdateProjectContractUseCase;
}

export class StoryboardApplication {
  public readonly drafts: DraftManager;
  public readonly manuscript: ManuscriptManager;
  public readonly cards: CardManager;
  public readonly novel: NovelManager;
  public readonly studio: StudioManager;
  public readonly notes: NoteManager;
  public readonly interviews: InterviewManager;
  public readonly project: ProjectManager;
  public readonly workspace: WorkspaceManager;
  public readonly runGate: RunGate;
  private readonly resourceRoots: readonly StoryUri[];
  public readonly aiGateway: AiGateway;
  public readonly aiProviderRegistry: AiProviderRegistry;
  public readonly configBridge: ConfigBridge;
  public readonly secretStore: SecretStore;
  public readonly logger: IStoryboardLogger;
  public readonly fileSystem: IFileSystem;
  public readonly usageMeter: UsageMeter;
  public readonly usageLedger: UsageLedgerRecorder;
  private readonly caches: WorkspaceCaches;
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
    this.interviews = new InterviewManager(services);
    this.project = new ProjectManager(services);
    this.runGate = new RunGate({ runLocks: services.runLocks, owner: options.lockOwner });
    this.resourceRoots = dependencies.resourceRoots ?? [];
    this.workspace = new WorkspaceManager({
      fileSystem: services.fileSystem,
      cards: services.cards,
      scenes: services.scenes,
      configBridge: services.configBridge,
      resourceRoots: this.resourceRoots,
      runGate: this.runGate,
      logger: services.logger,
    });
    this.aiGateway = services.aiGateway;
    this.aiProviderRegistry = services.aiProviderRegistry;
    this.configBridge = services.configBridge;
    this.secretStore = services.secretStore;
    this.logger = services.logger;
    this.fileSystem = services.fileSystem;
    this.usageMeter = services.usageMeter;
    this.usageLedger = services.usageLedger;
    this.caches = services.caches;
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
      project: this.project,
      interviews: this.interviews,
    });
  }

  public async dispose(): Promise<void> {
    this.usageLedger.dispose();
    await this.caches.closeAll();
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
  const caches: WorkspaceCaches = new WorkspaceCaches({
    host: dependencies.sqlDatabaseHost,
    fileSystem,
  });
  const runLocks: WorkspaceRunLocks = new WorkspaceRunLocks({ caches });
  const cards: WorkspaceCards = new WorkspaceCards({ fileSystem, caches });
  const scenes: WorkspaceScenes = new WorkspaceScenes({ fileSystem, caches, cards });
  const usageLedger: UsageLedgerRecorder = new UsageLedgerRecorder({ caches });
  const usageMeter: UsageMeter = new UsageMeter();
  const usageSink: IUsageSink = usageMeter.wrap(
    recordUsageWithoutFailingPaidGeneration([usageLedger, dependencies.usageObserver], logger),
  );
  const aiGateway: AiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);

  const host: HostAdapters = {
    fileSystem,
    workspaceLocator,
    logger,
    configBridge,
    secretStore,
    generator,
    caches,
    cards,
    scenes,
  };
  const ai: AiServices = { gateway: aiGateway, providerRegistry: aiProviderRegistry, usageSink };
  const repositories: WorkspaceRepositories = buildWorkspaceRepositories(
    host,
    dependencies.fetch ?? globalThis.fetch,
  );

  const assembleManuscriptUseCase: AssembleManuscriptUseCase = new AssembleManuscriptUseCase(
    host,
    repositories,
  );
  const summarizeChaptersUseCase: SummarizeChaptersUseCase = new SummarizeChaptersUseCase(
    host,
    ai,
    repositories,
  );
  const generateDraftUseCase: GenerateDraftUseCase = new GenerateDraftUseCase(
    host,
    ai,
    repositories,
  );
  const reviseDraftUseCase: ReviseDraftUseCase = new ReviseDraftUseCase(host, ai, repositories);
  const revisionPlanRecorder: RevisionPlanRecorder = new RevisionPlanRecorder(host);
  const reviseAfterGenerateGate: ReviseAfterGenerateGate = new ReviseAfterGenerateGate(host, {
    reviseDraftUseCase,
  });

  return {
    aiGateway,
    aiProviderRegistry,
    configBridge,
    secretStore,
    fileSystem,
    logger,
    caches,
    cards,
    scenes,
    runLocks,
    usageLedger,
    usageMeter,
    bibleCandidateRepository: repositories.bibleCandidates,
    cardSidebarRepository: repositories.cardSidebar,
    narratorCardRepository: repositories.narratorCards,
    novelRunStateRepository: repositories.novelRunState,
    sceneSidebarRepository: repositories.sceneSidebar,
    applyDraftFormatUseCase: new ApplyDraftFormatUseCase(host, ai),
    applyNoteAbsorbUseCase: new ApplyNoteAbsorbUseCase(host, repositories),
    exportNotesUseCase: new ExportNotesUseCase(host, repositories),
    applyStoryProposals: new ApplyStoryProposals(host),
    assembleManuscriptUseCase,
    augmentDraftUseCase: new AugmentDraftUseCase(host, ai),
    buildStoryCardsUseCase: new BuildStoryCardsUseCase(ai, repositories),
    checkDraftUseCase: new CheckDraftUseCase(host, ai),
    collectCardProposalsUseCase: new CollectCardProposalsUseCase(ai, repositories),
    collectNotesUseCase: new CollectNotesUseCase(repositories),
    completeStoryScenesUseCase: new CompleteStoryScenesUseCase(ai, repositories),
    condenseDraftUseCase: new CondenseDraftUseCase(host, ai),
    createCardUseCase: new CreateCardUseCase(repositories),
    createSceneUseCase: new CreateSceneUseCase(host),
    expandDraftUseCase: new ExpandDraftUseCase(host, ai),
    exportManuscriptUseCase: new ExportManuscriptUseCase(repositories),
    generateAllDraftsUseCase: new GenerateAllDraftsUseCase(host, repositories, {
      generateDraftUseCase,
      reviseAfterGenerateGate,
    }),
    generateDraftUseCase,
    generateOutlineUseCase: new GenerateOutlineUseCase(host, ai, repositories),
    generateSceneBeatsUseCase: new GenerateSceneBeatsUseCase(host, ai, repositories),
    generateStoryStateUseCase: new GenerateStoryStateUseCase(host, ai, repositories),
    novelPipeline: new NovelPipeline(host, ai, repositories, {
      assembleManuscriptUseCase,
      generateDraftUseCase,
      reviseDraftUseCase,
      summarizeChaptersUseCase,
    }),
    planNoteAbsorbUseCase: new PlanNoteAbsorbUseCase(host, ai, repositories),
    interviewSessionUseCase: new InterviewSessionUseCase(host, ai, repositories),
    describeInterviewCoverageUseCase: new DescribeInterviewCoverageUseCase(host, repositories),
    promoteBibleCandidatesUseCase: new PromoteBibleCandidatesUseCase(repositories),
    promoteNoteCandidatesUseCase: new PromoteNoteCandidatesUseCase(host, repositories),
    recommendCardsUseCase: new RecommendCardsUseCase(host, ai, repositories),
    renameCardUseCase: new RenameCardUseCase(host),
    renameSceneUseCase: new RenameSceneUseCase(host),
    reviewManuscriptUseCase: new ReviewManuscriptUseCase(host, ai, repositories),
    revisionPlanRecorder,
    reviseAfterGenerateGate,
    draftHistoryArchiver: new DraftHistoryArchiver(host),
    reviseDraftUseCase,
    saveDraftEditUseCase: new SaveDraftEditUseCase(host),
    seedScenesUseCase: new SeedScenesUseCase(host, repositories),
    studioChatUseCase: new StudioChatUseCase(host, ai),
    studioContextRepository: new StudioContextRepository(fileSystem, revisionPlanRecorder, cards, scenes),
    studioSessionRepository: new StudioSessionRepository(fileSystem),
    studioFollowUpRepository: new StudioFollowUpRepository(fileSystem),
    cardCollectRepository: new CardCollectRepository(fileSystem, cards),
    summarizeChaptersUseCase,
    updateProjectContractUseCase: new UpdateProjectContractUseCase(host),
  };
}

function buildWorkspaceRepositories(
  host: HostAdapters,
  fetch: NoteHttpFetch,
): WorkspaceRepositories {
  const { fileSystem, workspaceLocator } = host;
  const outline: OutlineRepository = new OutlineRepository(fileSystem, host.cards);
  const manuscriptAssembly: ManuscriptAssemblyRepository = new ManuscriptAssemblyRepository(
    fileSystem,
  );

  return {
    drafts: new DraftRepository(fileSystem),
    scenes: new SceneRepository(host.scenes),
    sceneBatches: new SceneBatchRepository(fileSystem, workspaceLocator, host.scenes),
    sceneSeeds: new SceneSeedRepository(host.scenes),
    sceneCache: new SceneCacheRepository(fileSystem),
    sceneSidebar: new SceneSidebarRepository(fileSystem, host.scenes),
    project: new ProjectRepository(fileSystem),
    outline,
    novelOutline: outline,
    novelRunState: new NovelRunStateRepository(fileSystem, host.caches),
    novelReviews: new NovelReviewRepository(fileSystem),
    manuscriptAssembly,
    chapterSummaries: manuscriptAssembly,
    manuscriptExport: manuscriptAssembly,
    manuscriptReview: manuscriptAssembly,
    cardWriter: new CardWriterRepository(fileSystem, host.cards),
    cardCollect: new CardCollectRepository(fileSystem, host.cards),
    cardRecommendations: new CardRecommendationRepository(fileSystem, host.cards, host.scenes),
    cardSidebar: new CardSidebarRepository(host.cards),
    narratorCards: new NarratorCardRepository(host.cards),
    bibleCandidates: new BibleCandidateRepository(fileSystem),
    storyFeatures: new StoryFeatureRepository(fileSystem, host.cards, host.scenes),
    noteAbsorb: new NoteAbsorbRepository(fileSystem, host.cards, host.scenes),
    noteSources: new NoteSourceProvider(host, { fetch }),
    interviews: new InterviewRepository(fileSystem),
  };
}

function recordUsageWithoutFailingPaidGeneration(
  sinks: readonly (IUsageSink | undefined)[],
  logger: IStoryboardLogger,
): IUsageSink {
  const presentSinks: readonly IUsageSink[] = sinks.filter(
    (sink): sink is IUsageSink => sink !== undefined,
  );

  return {
    record: async (workspaceRoot, usage): Promise<void> => {
      for (const sink of presentSinks) {
        try {
          await sink.record(workspaceRoot, usage);
        } catch (error) {
          logger.error('사용량 기록에 실패했습니다.', error);
        }
      }
    },
  };
}
