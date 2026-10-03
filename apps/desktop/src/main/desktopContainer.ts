import {
  getStoryboardProjectPaths,
  UsageLedgerRecorder,
  type IStoryboardLogger,
} from '@storyboard/story-engine';
import { NodeUri, type StoryUri, type StoryWorkspaceFolder } from '@storyboard/story-model';
import { StoryboardApplication, type ResourceOverrideReport } from '@storyboard/story-app';
import { ConfigBridge, SecretStore } from '@storyboard/story-ai';
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

// The managers and infrastructure handles a screen may reach, plus what only the desktop knows.
export interface DesktopContainer extends Pick<
  StoryboardApplication,
  | 'drafts'
  | 'manuscript'
  | 'cards'
  | 'novel'
  | 'studio'
  | 'runGate'
  | 'aiGateway'
  | 'aiProviderRegistry'
  | 'configBridge'
  | 'secretStore'
  | 'logger'
  | 'usageMeter'
  | 'postGenerationUpdates'
> {
  readonly workspaceRoot: StoryUri;
  readonly fileSystem: NodeFileSystem;
  readonly configuration: FileConfiguration;
  readonly loadResourceOverrides: () => Promise<ResourceOverrideReport>;
  readonly usageLedger: UsageLedgerRecorder;
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

// The desktop's side of the composition for one open workspace: only the host adapters are built
// here. The engine graph they feed is assembled once, for every app, by StoryboardApplication.
export function createDesktopContainer(options: DesktopContainerOptions): DesktopContainer {
  const workspaceRoot = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };
  const { logger } = options;

  const fileSystem = new NodeFileSystem();
  const secretStore = new SecretStore(createFileSecretStorage(options.homePaths.secretsFile));
  const configuration = createFileConfiguration({
    userConfigFile: options.homePaths.configFile,
    workspaceConfigFile: resolveWorkspaceConfigFile(workspaceRoot.fsPath),
    onInvalidFile: options.onInvalidConfigFile,
    onUnknownKey: (warning) => logger.warn(warning.message),
  });
  // NOTE: 프로바이더·모델·키처럼 작가가 한 번 고르는 값은 모든 작품에 걸린다(홈 파일). 작품마다
  // 다른 값(예산)은 호출하는 쪽이 작품 파일을 지정해 쓴다.
  const configBridge = new ConfigBridge({
    getConfiguration: () => configuration,
    writeTarget: configurationTargets.user,
  });
  const usageLedger = new UsageLedgerRecorder(fileSystem, (message) => logger.warn(message));

  const application = new StoryboardApplication(
    {
      fileSystem,
      workspaceLocator: new NodeWorkspaceLocator(folder),
      logger,
      secretStore,
      configBridge,
      usageLedger,
      resourceRoots: [
        NodeUri.file(options.homePaths.home),
        getStoryboardProjectPaths(workspaceRoot).metadataDirectory,
      ],
    },
    { generator: `storyboard-desktop@${options.version}`, lockOwner: 'desktop' },
  );

  return {
    drafts: application.drafts,
    manuscript: application.manuscript,
    cards: application.cards,
    novel: application.novel,
    studio: application.studio,
    runGate: application.runGate,
    aiGateway: application.aiGateway,
    aiProviderRegistry: application.aiProviderRegistry,
    configBridge: application.configBridge,
    secretStore: application.secretStore,
    logger: application.logger,
    usageMeter: application.usageMeter,
    postGenerationUpdates: application.postGenerationUpdates,
    fileSystem,
    workspaceRoot,
    configuration,
    usageLedger,
    loadResourceOverrides: () => application.loadResourceOverrides(),
  };
}
