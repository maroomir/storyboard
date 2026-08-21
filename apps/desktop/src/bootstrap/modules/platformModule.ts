import * as vscode from 'vscode';

import { AiGateway } from '../../application/ai/aiGateway';
import { RecommendCardsUseCase } from '../../application/cards/recommendCardsUseCase';
import { PromoteCardCandidatesUseCase } from '../../application/cards/promoteCardCandidatesUseCase';
import { CollectCardProposalsUseCase } from '../../application/cards/collectCardProposalsUseCase';
import { CreateCardUseCase } from '../../application/cards/createCardUseCase';
import { BuildStoryCardsUseCase } from '../../application/story/buildStoryCardsUseCase';
import { CompleteStoryScenesUseCase } from '../../application/story/completeStoryScenesUseCase';
import { PromoteBibleCandidatesUseCase } from '../../application/project/promoteBibleCandidatesUseCase';
import { AssembleManuscriptUseCase } from '../../application/manuscript/assembleManuscriptUseCase';
import { ExportManuscriptUseCase } from '../../application/manuscript/exportManuscriptUseCase';
import { ReviewManuscriptUseCase } from '../../application/manuscript/reviewManuscriptUseCase';
import { SummarizeChaptersUseCase } from '../../application/manuscript/summarizeChaptersUseCase';
import { ApplyDraftFormatUseCase } from '../../application/drafts/applyDraftFormatUseCase';
import { AugmentDraftUseCase } from '../../application/drafts/augmentDraftUseCase';
import { ExpandDraftUseCase } from '../../application/drafts/expandDraftUseCase';
import { CondenseDraftUseCase } from '../../application/drafts/condenseDraftUseCase';
import { GenerateDraftUseCase } from '../../application/drafts/generateDraftUseCase';
import { GenerateAllDraftsUseCase } from '../../application/drafts/generateAllDraftsUseCase';
import { ReviseDraftUseCase } from '../../application/drafts/reviseDraftUseCase';
import { ReviseAfterGenerateGate } from '../../application/drafts/reviseAfterGenerateGate';
import { NovelPipeline } from '../../application/novel/novelPipeline';
import { GenerateOutlineUseCase } from '../../application/novel/generateOutlineUseCase';
import { DraftRepository } from '../../infrastructure/persistence/repositories/draftRepository';
import { CardRecommendationRepository } from '../../infrastructure/persistence/repositories/cardRecommendationRepository';
import { CardCandidateRepository } from '../../infrastructure/persistence/repositories/cardCandidateRepository';
import { CardCollectRepository } from '../../infrastructure/persistence/repositories/cardCollectRepository';
import { CardWriterRepository } from '../../infrastructure/persistence/repositories/cardWriterRepository';
import { CardSidebarRepository } from '../../infrastructure/persistence/repositories/cardSidebarRepository';
import { StoryFeatureRepository } from '../../infrastructure/persistence/repositories/storyFeatureRepository';
import { BibleCandidateRepository } from '../../infrastructure/persistence/repositories/bibleCandidateRepository';
import { ProjectRepository } from '../../infrastructure/persistence/repositories/projectRepository';
import { OutlineRepository } from '../../infrastructure/persistence/repositories/outlineRepository';
import { NovelRunStateRepository } from '../../infrastructure/persistence/repositories/novelRunStateRepository';
import { NovelReviewRepository } from '../../infrastructure/persistence/repositories/novelReviewRepository';
import { SceneSeedRepository } from '../../infrastructure/persistence/repositories/sceneSeedRepository';
import { SceneCacheRepository } from '../../infrastructure/persistence/repositories/sceneCacheRepository';
import { SceneRepository } from '../../infrastructure/persistence/repositories/sceneRepository';
import { SceneBatchRepository } from '../../infrastructure/persistence/repositories/sceneBatchRepository';
import { SceneSidebarRepository } from '../../infrastructure/persistence/repositories/sceneSidebarRepository';
import { ManuscriptAssemblyRepository } from '../../infrastructure/persistence/repositories/manuscriptAssemblyRepository';
import { VscodeFileSystem } from '../../infrastructure/vscode/vscodeFileSystem';
import { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import { PostGenerationUpdateManager } from '../../infrastructure/ai/PostGenerationUpdateManager';
import {
  createVscodeUsageLedgerFileSystem,
  UsageRecorder,
} from '../../infrastructure/ai/UsageRecorder';
import { ProposalReviewService } from '../../presentation/providers/proposalReviewService';

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
  readonly logger: StoryboardLogger;
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

    const logger = new StoryboardLogger();
    const secretStore = new SecretStore(context.secrets);
    const configBridge = new ConfigBridge({
      getConfiguration: (): vscode.WorkspaceConfiguration =>
        vscode.workspace.getConfiguration('storyboard'),
      onDidChangeConfiguration: (listener): vscode.Disposable =>
        vscode.workspace.onDidChangeConfiguration(listener),
    });
    const aiProviderRegistry = createAiProviderRegistry({ secretStore, configBridge });
    const postGenerationUpdates = new PostGenerationUpdateManager();
    const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message): void =>
      logger.warn(message),
    );
    const aiGateway = new AiGateway(aiProviderRegistry, usageRecorder, logger);
    const applyDraftFormatUseCase = new ApplyDraftFormatUseCase(aiGateway, logger);
    const augmentDraftUseCase = new AugmentDraftUseCase(aiGateway, logger, configBridge);
    const expandDraftUseCase = new ExpandDraftUseCase(aiGateway, logger);
    const condenseDraftUseCase = new CondenseDraftUseCase(aiGateway, logger);
    const fileSystem = new VscodeFileSystem();
    const draftRepository = new DraftRepository(fileSystem);
    const cardRecommendationRepository = new CardRecommendationRepository();
    const cardCandidateRepository = new CardCandidateRepository(logger);
    const cardCollectRepository = new CardCollectRepository();
    const cardWriterRepository = new CardWriterRepository();
    const cardSidebarRepository = new CardSidebarRepository();
    const storyFeatureRepository = new StoryFeatureRepository();
    const proposalReviewService = new ProposalReviewService(context);
    const bibleCandidateRepository = new BibleCandidateRepository();
    const projectRepository = new ProjectRepository(fileSystem);
    const outlineRepository = new OutlineRepository();
    const novelRunStateRepository = new NovelRunStateRepository();
    const novelReviewRepository = new NovelReviewRepository();
    const sceneSeedRepository = new SceneSeedRepository();
    const sceneCacheRepository = new SceneCacheRepository(fileSystem);
    const sceneRepository = new SceneRepository(fileSystem);
    const sceneBatchRepository = new SceneBatchRepository();
    const sceneSidebarRepository = new SceneSidebarRepository();
    const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository();
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
      logger,
      postGenerationUpdates,
      projectRepository,
      sceneCacheRepository,
      sceneRepository,
    });
    const generateOutlineUseCase = new GenerateOutlineUseCase(aiGateway, outlineRepository);
    const reviseDraftUseCase = new ReviseDraftUseCase({
      aiProviderRegistry,
      usageRecorder,
      logger,
    });
    const reviseAfterGenerateGate = new ReviseAfterGenerateGate(
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
      usageRecorder,
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
