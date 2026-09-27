import {
  AiGateway,
  AssembleManuscriptUseCase,
  AugmentDraftUseCase,
  DraftRepository,
  GenerateDraftUseCase,
  ManuscriptAssemblyRepository,
  NodeUri,
  NovelPipeline,
  NovelReviewRepository,
  NovelRunStateRepository,
  OutlineRepository,
  PostGenerationUpdateManager,
  ProjectRepository,
  ReviseAfterGenerateGate,
  ReviseDraftUseCase,
  SaveDraftEditUseCase,
  SceneCacheRepository,
  SceneRepository,
  SceneSeedRepository,
  SummarizeChaptersUseCase,
  UsageLedgerRecorder,
  UsageMeter,
  type IStoryboardLogger,
  type IUsageSink,
  type StoryUri,
  type StoryWorkspaceFolder,
} from '@storyboard/story-engine';
import {
  ConfigBridge,
  createAiProviderRegistry,
  SecretStore,
  type AiProviderRegistry,
} from '@storyboard/story-ai';
import {
  configurationTargets,
  createFileConfiguration,
  createFileSecretStorage,
  resolveWorkspaceConfigFile,
  type ConfigFileError,
  type FileConfiguration,
  type StoryboardHomePaths,
} from '@storyboard/story-config';
import { NodeFileSystem, NodeWorkspaceLocator } from '@storyboard/story-node';

export interface DesktopContainer {
  readonly workspaceRoot: StoryUri;
  readonly logger: IStoryboardLogger;
  readonly fileSystem: NodeFileSystem;
  readonly configuration: FileConfiguration;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly aiGateway: AiGateway;
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly usageLedger: UsageLedgerRecorder;
  readonly usageMeter: UsageMeter;
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly novelPipeline: NovelPipeline;
  readonly novelRunStateRepository: NovelRunStateRepository;
  readonly outlineRepository: OutlineRepository;
  readonly postGenerationUpdates: PostGenerationUpdateManager;
}

export interface DesktopContainerOptions {
  readonly workspacePath: string;
  readonly homePaths: StoryboardHomePaths;
  readonly logger: IStoryboardLogger;
  readonly version: string;
  // A settings file the author broke by hand must not close the app. Reads fall back to defaults
  // for that file and the host tells the author which file it was.
  readonly onInvalidConfigFile: (error: ConfigFileError) => void;
}

// The desktop's service graph for one open workspace. It mirrors the CLI's container: only the host
// adapters differ, and only the use cases a desktop screen calls are built.
export function createDesktopContainer(options: DesktopContainerOptions): DesktopContainer {
  const workspaceRoot = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };
  const { logger } = options;

  const fileSystem = new NodeFileSystem();
  const workspaceLocator = new NodeWorkspaceLocator(folder);
  const secretStore = new SecretStore(createFileSecretStorage(options.homePaths.secretsFile));
  const configuration = createFileConfiguration({
    userConfigFile: options.homePaths.configFile,
    workspaceConfigFile: resolveWorkspaceConfigFile(workspaceRoot.fsPath),
    onInvalidFile: options.onInvalidConfigFile,
  });
  // NOTE: 프로바이더·모델·키처럼 작가가 한 번 고르는 값은 모든 작품에 걸린다(홈 파일). 작품마다
  // 다른 값(예산)은 호출하는 쪽이 작품 파일을 지정해 쓴다.
  const configBridge = new ConfigBridge({
    getConfiguration: () => configuration,
    writeTarget: configurationTargets.user,
  });
  const aiProviderRegistry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: true,
  });

  const usageLedger = new UsageLedgerRecorder(fileSystem, (message) => logger.warn(message));
  const usageMeter = new UsageMeter();
  const usageSink: IUsageSink = usageMeter.wrap({
    record: async (root, usage): Promise<void> => {
      // NOTE: accounting must never fail a generation the author already paid for.
      try {
        await usageLedger.record(root, usage);
      } catch (error) {
        logger.error('사용량 기록에 실패했습니다.', error);
      }
    },
  });
  const aiGateway = new AiGateway(aiProviderRegistry, usageSink, logger);
  const generator = `storyboard-desktop@${options.version}`;

  const sceneCacheRepository = new SceneCacheRepository(fileSystem);
  const outlineRepository = new OutlineRepository(fileSystem);
  const novelRunStateRepository = new NovelRunStateRepository(fileSystem);
  const manuscriptAssemblyRepository = new ManuscriptAssemblyRepository(fileSystem);
  const postGenerationUpdates = new PostGenerationUpdateManager();

  const assembleManuscriptUseCase = new AssembleManuscriptUseCase(
    logger,
    manuscriptAssemblyRepository,
  );
  const summarizeChaptersUseCase = new SummarizeChaptersUseCase(
    aiGateway,
    manuscriptAssemblyRepository,
  );
  const generateDraftUseCase = new GenerateDraftUseCase({
    aiGateway,
    configBridge,
    draftRepository: new DraftRepository(fileSystem),
    fileSystem,
    generator,
    logger,
    postGenerationUpdates,
    projectRepository: new ProjectRepository(fileSystem),
    sceneCacheRepository,
    sceneRepository: new SceneRepository(fileSystem),
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

  return {
    workspaceRoot,
    logger,
    fileSystem,
    configuration,
    configBridge,
    secretStore,
    aiGateway,
    aiProviderRegistry,
    usageLedger,
    usageMeter,
    generateDraftUseCase,
    reviseAfterGenerateGate: new ReviseAfterGenerateGate(
      fileSystem,
      workspaceLocator,
      configBridge,
      logger,
      reviseDraftUseCase,
    ),
    augmentDraftUseCase: new AugmentDraftUseCase(fileSystem, aiGateway, logger, configBridge),
    saveDraftEditUseCase: new SaveDraftEditUseCase(fileSystem),
    novelPipeline: new NovelPipeline({
      aiGateway,
      aiProviderRegistry,
      assembleManuscriptUseCase,
      configBridge,
      generateDraftUseCase,
      logger,
      novelReviewRepository: new NovelReviewRepository(fileSystem),
      novelRunStateRepository,
      outlineRepository,
      reviseDraftUseCase,
      sceneSeedRepository: new SceneSeedRepository(fileSystem),
      summarizeChaptersUseCase,
      usageSink,
      fileSystem,
    }),
    novelRunStateRepository,
    outlineRepository,
    postGenerationUpdates,
  };
}
