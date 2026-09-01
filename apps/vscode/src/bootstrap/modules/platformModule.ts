import * as vscode from 'vscode';

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
  SceneBatchRepository,
  SceneCacheRepository,
  SceneRepository,
  SceneSeedRepository,
  SceneSidebarRepository,
  StoryFeatureRepository,
  StudioChatUseCase,
  SummarizeChaptersUseCase,
} from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import { createUsageSink } from '@/infrastructure/ai/usageSink';
import {
  createVscodeUsageLedgerFileSystem,
  UsageRecorder,
} from '@/infrastructure/ai/UsageRecorder';
import { OutputChannelLogger } from '@/infrastructure/vscode/logger';
import { VscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { VscodeWorkspaceLocator } from '@/infrastructure/vscode/workspaceLocator';
import { ProposalReviewService } from '@/presentation/providers/proposalReviewService';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';

export interface IPlatformServices {
  readonly aiGateway: AiGateway;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly cardSidebarRepository: CardSidebarRepository;
  readonly fileSystem: VscodeFileSystem;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly logger: IStoryboardLogger;
  readonly studioChatUseCase: StudioChatUseCase;
  readonly novelPipeline: NovelPipeline;
  readonly novelRunStateRepository: NovelRunStateRepository;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly reviewManuscriptUseCase: ReviewManuscriptUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly sceneSidebarRepository: SceneSidebarRepository;
  readonly secretStore: SecretStore;
  readonly summarizeChaptersUseCase: SummarizeChaptersUseCase;
  readonly usageRecorder: UsageRecorder;
  readonly proposalReviewService: ProposalReviewService;
}

export class PlatformModule implements IApplicationModule {
  private services: IPlatformServices | undefined;
  private readonly disposables = new DisposableStore();

  public initialize(context: vscode.ExtensionContext): void {
    if (this.services) {
      throw new Error('PlatformModule is already initialized.');
    }

    const logger = new OutputChannelLogger();
    const secretStore = new SecretStore(context.secrets);
    const configBridge = new ConfigBridge({
      getConfiguration: (): vscode.WorkspaceConfiguration =>
        vscode.workspace.getConfiguration('storyboard'),
      onDidChangeConfiguration: (listener): vscode.Disposable =>
        vscode.workspace.onDidChangeConfiguration(listener),
    });
    const aiProviderRegistry = createAiProviderRegistry({ secretStore, configBridge });
    const fileSystem = new VscodeFileSystem();
    const workspaceLocator = new VscodeWorkspaceLocator();
    const postGenerationUpdates = new PostGenerationUpdateManager();
    const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message): void =>
      logger.warn(message),
    );
    const usageSink = createUsageSink(usageRecorder, logger);
    const aiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);
    const generator = `storyboard@${context.extension.packageJSON.version}`;
    const applyDraftFormatUseCase = new ApplyDraftFormatUseCase(
      fileSystem,
      aiGateway,
      logger,
      generator,
    );
    const augmentDraftUseCase = new AugmentDraftUseCase(
      fileSystem,
      aiGateway,
      logger,
      configBridge,
    );
    const expandDraftUseCase = new ExpandDraftUseCase(aiGateway, logger);
    const condenseDraftUseCase = new CondenseDraftUseCase(aiGateway, logger);
    const studioChatUseCase = new StudioChatUseCase(aiGateway, logger);
    const draftRepository = new DraftRepository(fileSystem);
    const cardRecommendationRepository = new CardRecommendationRepository(fileSystem);
    const cardCandidateRepository = new CardCandidateRepository(fileSystem, logger);
    const cardCollectRepository = new CardCollectRepository(fileSystem);
    const cardWriterRepository = new CardWriterRepository(fileSystem);
    const cardSidebarRepository = new CardSidebarRepository(fileSystem);
    const storyFeatureRepository = new StoryFeatureRepository(fileSystem);
    const proposalReviewService = new ProposalReviewService(context);
    const bibleCandidateRepository = new BibleCandidateRepository(fileSystem);
    const projectRepository = new ProjectRepository(fileSystem);
    const outlineRepository = new OutlineRepository(fileSystem);
    const novelRunStateRepository = new NovelRunStateRepository(fileSystem);
    const novelReviewRepository = new NovelReviewRepository(fileSystem);
    const sceneSeedRepository = new SceneSeedRepository(fileSystem);
    const sceneCacheRepository = new SceneCacheRepository(fileSystem);
    const sceneRepository = new SceneRepository(fileSystem);
    const sceneBatchRepository = new SceneBatchRepository(fileSystem, workspaceLocator);
    const sceneSidebarRepository = new SceneSidebarRepository(fileSystem);
    const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository(fileSystem);
    const assembleManuscriptUseCase = new AssembleManuscriptUseCase(
      logger,
      manuscriptAssemblyRepository,
    );
    const exportManuscriptUseCase = new ExportManuscriptUseCase(manuscriptAssemblyRepository);
    const summarizeChaptersUseCase = new SummarizeChaptersUseCase(
      aiGateway,
      manuscriptAssemblyRepository,
    );
    const reviewManuscriptUseCase = new ReviewManuscriptUseCase(
      aiGateway,
      manuscriptAssemblyRepository,
      logger,
    );
    const generateDraftUseCase = new GenerateDraftUseCase({
      aiGateway,
      configBridge,
      draftRepository,
      fileSystem,
      generator,
      logger,
      postGenerationUpdates,
      projectRepository,
      sceneCacheRepository,
      sceneRepository,
      workspaceLocator,
    });
    const generateOutlineUseCase = new GenerateOutlineUseCase(aiGateway, outlineRepository);
    const reviseDraftUseCase = new ReviseDraftUseCase({
      aiProviderRegistry,
      usageSink,
      fileSystem,
      logger,
      generator,
      sceneCacheRepository,
    });
    const reviseAfterGenerateGate = new ReviseAfterGenerateGate(
      fileSystem,
      workspaceLocator,
      configBridge,
      logger,
      reviseDraftUseCase,
    );
    const generateAllDraftsUseCase = new GenerateAllDraftsUseCase(
      generateDraftUseCase,
      logger,
      reviseAfterGenerateGate,
      sceneBatchRepository,
    );
    const recommendCardsUseCase = new RecommendCardsUseCase(
      aiGateway,
      logger,
      cardRecommendationRepository,
    );
    const collectCardProposalsUseCase = new CollectCardProposalsUseCase(
      aiGateway,
      cardCollectRepository,
    );
    const createCardUseCase = new CreateCardUseCase(cardWriterRepository);
    const buildStoryCardsUseCase = new BuildStoryCardsUseCase(aiGateway, storyFeatureRepository);
    const completeStoryScenesUseCase = new CompleteStoryScenesUseCase(
      aiGateway,
      storyFeatureRepository,
    );
    const promoteCardCandidatesUseCase = new PromoteCardCandidatesUseCase(cardCandidateRepository);
    const promoteBibleCandidatesUseCase = new PromoteBibleCandidatesUseCase(
      bibleCandidateRepository,
    );
    const novelPipeline = new NovelPipeline({
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
    });

    this.services = {
      aiGateway,
      applyDraftFormatUseCase,
      assembleManuscriptUseCase,
      augmentDraftUseCase,
      aiProviderRegistry,
      collectCardProposalsUseCase,
      buildStoryCardsUseCase,
      completeStoryScenesUseCase,
      createCardUseCase,
      cardSidebarRepository,
      configBridge,
      condenseDraftUseCase,
      expandDraftUseCase,
      exportManuscriptUseCase,
      fileSystem,
      generateAllDraftsUseCase,
      generateDraftUseCase,
      generateOutlineUseCase,
      logger,
      novelPipeline,
      novelRunStateRepository,
      postGenerationUpdates,
      promoteBibleCandidatesUseCase,
      promoteCardCandidatesUseCase,
      recommendCardsUseCase,
      reviewManuscriptUseCase,
      reviseAfterGenerateGate,
      studioChatUseCase,
      reviseDraftUseCase,
      sceneSidebarRepository,
      secretStore,
      summarizeChaptersUseCase,
      usageRecorder,
      proposalReviewService,
    };
    this.disposables.add(
      logger,
      postGenerationUpdates,
      usageRecorder,
      configBridge.onDidChange((): void => logger.info('Storyboard configuration changed')),
      proposalReviewService,
    );

    logger.info('Activating Storyboard extension');
  }

  public getServices(): IPlatformServices {
    if (!this.services) {
      throw new Error('PlatformModule has not been initialized.');
    }

    return this.services;
  }

  public dispose(): void {
    this.disposables.dispose();

    this.services = undefined;
  }
}
