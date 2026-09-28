import {
  NodeUri,
  UsageLedgerRecorder,
  type IStoryboardLogger,
  type StoryUri,
  type StoryWorkspaceFolder,
} from '@storyboard/story-engine';
import { StoryboardApplication, type StoryboardServices } from '@storyboard/story-app';
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

export interface DesktopContainer extends StoryboardServices {
  readonly workspaceRoot: StoryUri;
  readonly fileSystem: NodeFileSystem;
  readonly configuration: FileConfiguration;
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
    },
    { generator: `storyboard-desktop@${options.version}` },
  );

  return {
    ...application.services,
    fileSystem,
    workspaceRoot,
    configuration,
    usageLedger,
  };
}
