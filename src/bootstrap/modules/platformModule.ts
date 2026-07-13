import * as vscode from 'vscode';

import { AiGateway } from '../../application/ai/aiGateway';
import { RecommendCardsUseCase } from '../../application/cards/recommendCardsUseCase';
import { PromoteCardCandidatesUseCase } from '../../application/cards/promoteCardCandidatesUseCase';
import { CollectCardProposalsUseCase } from '../../application/cards/collectCardProposalsUseCase';
import { CreateCardUseCase } from '../../application/cards/createCardUseCase';
import { PromoteBibleCandidatesUseCase } from '../../application/project/promoteBibleCandidatesUseCase';
import { DecodeSeedUseCase } from '../../application/project/decodeSeedUseCase';
import { PrepareSeedSyncUseCase } from '../../application/project/prepareSeedSyncUseCase';
import { SeedProjectUseCase } from '../../application/project/seedProjectUseCase';
import { AssembleManuscriptUseCase } from '../../application/manuscript/assembleManuscriptUseCase';
import { ReviewManuscriptUseCase } from '../../application/manuscript/reviewManuscriptUseCase';
import { SummarizeChaptersUseCase } from '../../application/manuscript/summarizeChaptersUseCase';
import { AugmentDraftUseCase } from '../../application/drafts/augmentDraftUseCase';
import { GenerateDraftUseCase } from '../../application/drafts/generateDraftUseCase';
import { GenerateAllDraftsUseCase } from '../../application/drafts/generateAllDraftsUseCase';
import { ReviseDraftUseCase } from '../../application/drafts/revise-draft-use-case';
import { ReviseAfterGenerateGate } from '../../application/drafts/reviseAfterGenerateGate';
import { NovelPipeline } from '../../application/novel/novel-pipeline';
import { GenerateOutlineUseCase } from '../../application/novel/generateOutlineUseCase';
import { DraftRepository } from '../../infrastructure/persistence/repositories/draftRepository';
import { CardRecommendationRepository } from '../../infrastructure/persistence/repositories/cardRecommendationRepository';
import { CardCandidateRepository } from '../../infrastructure/persistence/repositories/cardCandidateRepository';
import { CardCollectRepository } from '../../infrastructure/persistence/repositories/cardCollectRepository';
import { CardWriterRepository } from '../../infrastructure/persistence/repositories/cardWriterRepository';
import { CardSidebarRepository } from '../../infrastructure/persistence/repositories/cardSidebarRepository';
import { BibleCandidateRepository } from '../../infrastructure/persistence/repositories/bibleCandidateRepository';
import { ProjectRepository } from '../../infrastructure/persistence/repositories/projectRepository';
import { OutlineRepository } from '../../infrastructure/persistence/repositories/outlineRepository';
import { SceneCacheRepository } from '../../infrastructure/persistence/repositories/sceneCacheRepository';
import { SceneRepository } from '../../infrastructure/persistence/repositories/sceneRepository';
import { SceneBatchRepository } from '../../infrastructure/persistence/repositories/sceneBatchRepository';
import { SceneSidebarRepository } from '../../infrastructure/persistence/repositories/sceneSidebarRepository';
import { SeedProjectRepository } from '../../infrastructure/persistence/repositories/seedProjectRepository';
import { ManuscriptAssemblyRepository } from '../../infrastructure/persistence/repositories/manuscriptAssemblyRepository';
import { VscodeFileSystem } from '../../infrastructure/vscode/vscodeFileSystem';
import { StoryboardLogger } from '../../core/logger';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
} from '../../services/ai/providerRegistry';
import { PostGenerationUpdateManager } from '../../services/ai/PostGenerationUpdateManager';
import { createVscodeUsageLedgerFileSystem, UsageRecorder } from '../../services/ai/UsageRecorder';
import { SecretStore } from '../../services/secrets/SecretStore';
import { ConfigBridge } from '../../services/settings/ConfigBridge';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';

export interface IPlatformServices {
  readonly aiGateway: AiGateway;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly decodeSeedUseCase: DecodeSeedUseCase;
  readonly seedProjectUseCase: SeedProjectUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly createCardUseCase: CreateCardUseCase;
  readonly cardSidebarRepository: CardSidebarRepository;
  readonly fileSystem: VscodeFileSystem;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly logger: StoryboardLogger;
  readonly novelPipeline: NovelPipeline;
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
    const decodeSeedUseCase = new DecodeSeedUseCase();
    const prepareSeedSyncUseCase = new PrepareSeedSyncUseCase();
    const augmentDraftUseCase = new AugmentDraftUseCase(aiGateway, logger);
    const fileSystem = new VscodeFileSystem();
    const draftRepository = new DraftRepository(fileSystem);
    const cardRecommendationRepository = new CardRecommendationRepository();
    const cardCandidateRepository = new CardCandidateRepository(logger);
    const cardCollectRepository = new CardCollectRepository();
    const cardWriterRepository = new CardWriterRepository();
    const cardSidebarRepository = new CardSidebarRepository();
    const bibleCandidateRepository = new BibleCandidateRepository();
    const projectRepository = new ProjectRepository(fileSystem);
    const outlineRepository = new OutlineRepository();
    const sceneCacheRepository = new SceneCacheRepository(fileSystem);
    const sceneRepository = new SceneRepository(fileSystem);
    const sceneBatchRepository = new SceneBatchRepository();
    const sceneSidebarRepository = new SceneSidebarRepository();
    const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository();
    const seedProjectRepository = new SeedProjectRepository();
    const seedProjectUseCase = new SeedProjectUseCase(
      logger,
      prepareSeedSyncUseCase,
      seedProjectRepository,
    );
    const assembleManuscriptUseCase = new AssembleManuscriptUseCase(
      logger,
      manuscriptAssemblyRepository,
    );
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
    const promoteCardCandidatesUseCase = new PromoteCardCandidatesUseCase(cardCandidateRepository);
    const promoteBibleCandidatesUseCase = new PromoteBibleCandidatesUseCase(
      bibleCandidateRepository,
    );
    const novelPipeline = new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      configBridge,
      generateDraftUseCase,
      logger,
      reviseDraftUseCase,
      usageRecorder,
    });

    this.services = {
      aiGateway,
      assembleManuscriptUseCase,
      augmentDraftUseCase,
      aiProviderRegistry,
      collectCardProposalsUseCase,
      createCardUseCase,
      cardSidebarRepository,
      configBridge,
      decodeSeedUseCase,
      fileSystem,
      generateAllDraftsUseCase,
      generateDraftUseCase,
      generateOutlineUseCase,
      logger,
      novelPipeline,
      postGenerationUpdates,
      promoteBibleCandidatesUseCase,
      promoteCardCandidatesUseCase,
      recommendCardsUseCase,
      reviewManuscriptUseCase,
      reviseAfterGenerateGate,
      reviseDraftUseCase,
      sceneSidebarRepository,
      secretStore,
      seedProjectUseCase,
      summarizeChaptersUseCase,
      usageRecorder,
    };
    this.disposables.add(
      logger,
      postGenerationUpdates,
      usageRecorder,
      configBridge.onDidChange((): void => logger.info('Storyboard configuration changed')),
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
