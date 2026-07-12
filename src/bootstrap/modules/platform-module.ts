import * as vscode from 'vscode';

import { AiGateway } from '../../application/ai/ai-gateway';
import { RecommendCardsUseCase } from '../../application/cards/recommend-cards-use-case';
import { PromoteCardCandidatesUseCase } from '../../application/cards/promote-card-candidates-use-case';
import { CollectCardProposalsUseCase } from '../../application/cards/collect-card-proposals-use-case';
import { PromoteBibleCandidatesUseCase } from '../../application/project/promote-bible-candidates-use-case';
import { DecodeSeedUseCase } from '../../application/project/decode-seed-use-case';
import { AugmentDraftUseCase } from '../../application/drafts/augment-draft-use-case';
import { GenerateDraftUseCase } from '../../application/drafts/generate-draft-use-case';
import { ReviseDraftUseCase } from '../../application/drafts/revise-draft-use-case';
import { NovelPipeline } from '../../application/novel/novel-pipeline';
import { DraftRepository } from '../../infrastructure/persistence/repositories/draft-repository';
import { CardRecommendationRepository } from '../../infrastructure/persistence/repositories/card-recommendation-repository';
import { CardCandidateRepository } from '../../infrastructure/persistence/repositories/card-candidate-repository';
import { CardCollectRepository } from '../../infrastructure/persistence/repositories/card-collect-repository';
import { CardSidebarRepository } from '../../infrastructure/persistence/repositories/card-sidebar-repository';
import { BibleCandidateRepository } from '../../infrastructure/persistence/repositories/bible-candidate-repository';
import { ProjectRepository } from '../../infrastructure/persistence/repositories/project-repository';
import { SceneCacheRepository } from '../../infrastructure/persistence/repositories/scene-cache-repository';
import { SceneRepository } from '../../infrastructure/persistence/repositories/scene-repository';
import { SceneSidebarRepository } from '../../infrastructure/persistence/repositories/scene-sidebar-repository';
import { VscodeFileSystem } from '../../infrastructure/vscode/vscode-file-system';
import { StoryboardLogger } from '../../core/logger';
import {
  createAiProviderRegistry,
  type AiProviderRegistry,
} from '../../services/ai/providerRegistry';
import { PostGenerationUpdateManager } from '../../services/ai/PostGenerationUpdateManager';
import { createVscodeUsageLedgerFileSystem, UsageRecorder } from '../../services/ai/UsageRecorder';
import { SecretStore } from '../../services/secrets/SecretStore';
import { ConfigBridge } from '../../services/settings/ConfigBridge';

import { DisposableStore } from '../lifecycle/disposable-store';
import type { IApplicationModule } from '../lifecycle/application-module';

export interface IPlatformServices {
  readonly aiGateway: AiGateway;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly decodeSeedUseCase: DecodeSeedUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly cardSidebarRepository: CardSidebarRepository;
  readonly fileSystem: VscodeFileSystem;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly logger: StoryboardLogger;
  readonly novelPipeline: NovelPipeline;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly sceneSidebarRepository: SceneSidebarRepository;
  readonly secretStore: SecretStore;
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
    const augmentDraftUseCase = new AugmentDraftUseCase(aiGateway, logger);
    const fileSystem = new VscodeFileSystem();
    const draftRepository = new DraftRepository(fileSystem);
    const cardRecommendationRepository = new CardRecommendationRepository();
    const cardCandidateRepository = new CardCandidateRepository(logger);
    const cardCollectRepository = new CardCollectRepository();
    const cardSidebarRepository = new CardSidebarRepository();
    const bibleCandidateRepository = new BibleCandidateRepository();
    const projectRepository = new ProjectRepository(fileSystem);
    const sceneCacheRepository = new SceneCacheRepository(fileSystem);
    const sceneRepository = new SceneRepository(fileSystem);
    const sceneSidebarRepository = new SceneSidebarRepository();
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
    const reviseDraftUseCase = new ReviseDraftUseCase({
      aiProviderRegistry,
      usageRecorder,
      logger,
    });
    const recommendCardsUseCase = new RecommendCardsUseCase(
      aiGateway,
      logger,
      cardRecommendationRepository,
    );
    const collectCardProposalsUseCase = new CollectCardProposalsUseCase(
      aiGateway,
      cardCollectRepository,
    );
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
      augmentDraftUseCase,
      aiProviderRegistry,
      collectCardProposalsUseCase,
      cardSidebarRepository,
      configBridge,
      decodeSeedUseCase,
      fileSystem,
      generateDraftUseCase,
      logger,
      novelPipeline,
      postGenerationUpdates,
      promoteBibleCandidatesUseCase,
      promoteCardCandidatesUseCase,
      recommendCardsUseCase,
      reviseDraftUseCase,
      sceneSidebarRepository,
      secretStore,
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
