import {
  getStoryboardProjectPaths,
  NodeUri,
  type StoryUri,
  type StoryWorkspaceFolder,
} from '@storyboard/story-model';
import { UsageLedgerRecorder, type IStoryboardLogger } from '@storyboard/story-engine';
import { StoryboardApplication } from '@storyboard/story-app';
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

export interface DesktopContainer extends Pick<
  StoryboardApplication,
  | 'drafts'
  | 'manuscript'
  | 'cards'
  | 'notes'
  | 'novel'
  | 'project'
  | 'workspace'
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
  readonly usageLedger: UsageLedgerRecorder;
}

export interface DesktopContainerOptions {
  readonly workspacePath: string;
  readonly homePaths: StoryboardHomePaths;
  readonly logger: IStoryboardLogger;
  readonly version: string;
  readonly onInvalidConfigFile: (error: ConfigFileError) => void;
}

export function createDesktopContainer(options: DesktopContainerOptions): DesktopContainer {
  const workspaceRoot: NodeUri = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };
  const { logger } = options;

  const fileSystem: NodeFileSystem = new NodeFileSystem();
  const secretStore: SecretStore = new SecretStore(
    createFileSecretStorage(options.homePaths.secretsFile),
  );
  const configuration: FileConfiguration = createFileConfiguration({
    userConfigFile: options.homePaths.configFile,
    workspaceConfigFile: resolveWorkspaceConfigFile(workspaceRoot.fsPath),
    onInvalidFile: options.onInvalidConfigFile,
    onUnknownKey: (warning) => logger.warn(warning.message),
  });
  const configBridge: ConfigBridge = new ConfigBridge({
    getConfiguration: () => configuration,
    writeTarget: configurationTargets.user,
  });
  const usageLedger: UsageLedgerRecorder = new UsageLedgerRecorder(fileSystem, (message) =>
    logger.warn(message),
  );

  const application: StoryboardApplication = new StoryboardApplication(
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
    notes: application.notes,
    novel: application.novel,
    project: application.project,
    workspace: application.workspace,
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
  };
}
