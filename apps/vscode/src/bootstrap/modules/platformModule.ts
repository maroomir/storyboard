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
  GenerateSceneBeatsUseCase,
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
import type { AiProviderRegistry, StoryboardConfigurationLike } from '@storyboard/story-ai';
import { createUsageSink } from '@/infrastructure/ai/usageSink';
import { migrateVscodeSettingsToHome } from '@/infrastructure/settings/migrateVscodeSettings';
import {
  createStoryboardHomeStores,
  type StoryboardHomeStores,
} from '@/infrastructure/settings/storyboardHome';
import {
  createVscodeUsageLedgerFileSystem,
  UsageRecorder,
} from '@/infrastructure/ai/UsageRecorder';
import { OutputChannelLogger } from '@/infrastructure/vscode/logger';
import { VscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import { VscodeWorkspaceLocator } from '@/infrastructure/vscode/workspaceLocator';
import { ProposalReviewService } from '@/presentation/providers/proposalReviewService';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';

export interface IPlatformServices {
  readonly aiGateway: AiGateway;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly assembleManuscriptUseCase: AssembleManuscriptUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly configBridge: ConfigBridge;
  readonly homeStores: StoryboardHomeStores;
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
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
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
    const homeStores = createStoryboardHomeStores({
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      onInvalidFile: (error): void => reportInvalidConfigFile(error.file, error.message, logger),
    });
    const secretStore = new SecretStore(homeStores.secretStorage);
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => homeStores.configuration,
      onDidChangeConfiguration: homeStores.onDidChangeConfiguration,
    });
    void migrateLegacySettings(context, homeStores, logger);
    const aiProviderRegistry = createAiProviderRegistry({
      secretStore,
      configBridge,
      requireConfiguredProvider: true,
    });
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
    const generateSceneBeatsUseCase = new GenerateSceneBeatsUseCase({
      aiGateway,
      configBridge,
      fileSystem,
      logger,
      sceneRepository,
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
      homeStores,
      condenseDraftUseCase,
      expandDraftUseCase,
      exportManuscriptUseCase,
      fileSystem,
      generateAllDraftsUseCase,
      generateDraftUseCase,
      generateOutlineUseCase,
      generateSceneBeatsUseCase,
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
      homeStores,
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

// A settings file the author broke by hand must not take the whole extension down, but it must
// not be silent either: every read falls back to defaults and the author is told which file.
const reportedInvalidFiles = new Set<string>();

function reportInvalidConfigFile(file: string, message: string, logger: IStoryboardLogger): void {
  logger.warn(message);

  if (reportedInvalidFiles.has(file)) {
    return;
  }

  reportedInvalidFiles.add(file);
  void vscode.window
    .showWarningMessage(`${message} 고칠 때까지 기본값으로 동작합니다.`, '파일 열기')
    .then((choice) => {
      if (choice === '파일 열기') {
        void vscode.window.showTextDocument(vscode.Uri.file(file));
      }
    });
}

async function migrateLegacySettings(
  context: vscode.ExtensionContext,
  homeStores: StoryboardHomeStores,
  logger: IStoryboardLogger,
): Promise<void> {
  try {
    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: vscode.workspace.getConfiguration('storyboard'),
      vscodeSecrets: context.secrets,
      homeConfiguration: homeStores.configuration,
      homeSecrets: homeStores.secretStorage,
      hasWorkspaceConfigFile: homeStores.workspaceConfigFile !== undefined,
    });

    if (result.movedSettings.length === 0 && result.movedApiKeys.length === 0) {
      return;
    }

    logger.info(
      `VSCode 설정 ${result.movedSettings.length}개와 API 키 ${result.movedApiKeys.length}개를 ${homeStores.paths.home} 으로 옮겼습니다.`,
    );
    const choice = await vscode.window.showInformationMessage(
      `Storyboard 설정을 ${homeStores.paths.configFile} 로 옮겼습니다. 이제 세 앱이 같은 설정을 씁니다.`,
      '파일 열기',
    );

    if (choice === '파일 열기') {
      await vscode.window.showTextDocument(vscode.Uri.file(homeStores.paths.configFile));
    }
  } catch (error) {
    logger.error('VSCode 설정을 ~/.storyboard 로 옮기지 못했습니다.', error);
  }
}
