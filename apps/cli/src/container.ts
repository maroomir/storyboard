import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  getStoryboardProjectPaths,
  NodeUri,
  STORYBOARD_RELATIVE_PATHS,
  type StoryUri,
  type StoryWorkspaceFolder,
} from '@storyboard/story-model';
import { type IUsageSink } from '@storyboard/story-engine';
import {
  StoryboardApplication,
  type ParameterReport,
  type ResourceOverrideReport,
  type WorkspaceStatus,
} from '@storyboard/story-app';
import {
  ConfigBridge,
  type ConfigBridgeDependencies,
  type PromptVariantId,
  SecretStore,
} from '@storyboard/story-ai';

import type { IStoryboardLogger } from '@storyboard/story-engine';

import { NodeFileSystem, NodeWorkspaceLocator } from '@storyboard/story-node';
import { PauseRequests } from '@/adapters/pauseRequests';
import type { IPrompter } from '@/adapters/prompter';
import { LineRunProgress, type IRunProgress } from '@/adapters/runProgress';
import { resolveCliPaths, type CliPaths } from '@/adapters/paths';
import {
  configurationTargets,
  createFileConfiguration,
  createFileSecretStorage,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
  type ConfigurationTarget,
  type FileConfiguration,
  type StoryboardHomePaths,
} from '@storyboard/story-config';

export interface CliContainer extends Pick<
  StoryboardApplication,
  | 'drafts'
  | 'manuscript'
  | 'cards'
  | 'novel'
  | 'studio'
  | 'notes'
  | 'runGate'
  | 'aiGateway'
  | 'aiProviderRegistry'
  | 'configBridge'
  | 'secretStore'
  | 'logger'
  | 'usageMeter'
> {
  readonly workspaceRoot: StoryUri;
  readonly homePaths: StoryboardHomePaths;
  readonly loadResourceOverrides: () => Promise<ResourceOverrideReport>;
  readonly describeParameters: () => Promise<ParameterReport>;
  readonly describeWorkspace: () => Promise<WorkspaceStatus>;
  readonly workspaceConfigFile: string | undefined;
  readonly configWriteFile: string;
  readonly canPrompt: boolean;
  readonly fileSystem: NodeFileSystem;
  readonly progress: IRunProgress;
  readonly pauseRequests: PauseRequests;
  readonly prompter?: IPrompter;
  readonly version: string;
}

export interface CliContainerOptions {
  readonly workspacePath: string;
  readonly logger: IStoryboardLogger;
  readonly progress?: IRunProgress;
  readonly pauseRequests?: PauseRequests;
  readonly prompter?: IPrompter;
  readonly canPrompt: boolean;
  readonly version: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reviseMaxIterations?: number;
  readonly configWriteTarget?: ConfigurationTarget;
  readonly usageSink?: IUsageSink;
  readonly createConfigBridge?: (dependencies: ConfigBridgeDependencies) => ConfigBridge;
  readonly postGenerationUpdates?: boolean;
  readonly localRuntime?: {
    readonly baseUrl?: string;
    readonly contextTokens?: number;
    readonly think?: boolean;
  };
  readonly promptVariant?: PromptVariantId;
}

function createCommandLineConfigOverrides(options: CliContainerOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (options.provider !== undefined) {
    overrides['ai.provider.default'] = options.provider;
    const everyTaskFollowsCommandLineProvider: Record<string, unknown> = {};
    overrides['tasks'] = everyTaskFollowsCommandLineProvider;

    if (options.model !== undefined) {
      overrides[`providers.${options.provider}.model`] = options.model;
    }
  }

  if (options.reviseMaxIterations !== undefined) {
    overrides['revise.loop.maxIterations'] = options.reviseMaxIterations;
  }

  if (options.localRuntime?.baseUrl !== undefined) {
    overrides['providers.ollama.baseUrl'] = options.localRuntime.baseUrl;
  }

  if (options.localRuntime?.contextTokens !== undefined) {
    overrides['providers.ollama.contextTokens'] = options.localRuntime.contextTokens;
  }

  if (options.localRuntime?.think !== undefined) {
    overrides['providers.ollama.think'] = options.localRuntime.think;
  }

  if (options.promptVariant !== undefined) {
    overrides['ai.prompt.variant'] = options.promptVariant;
  }

  return overrides;
}

export function createCliContainer(options: CliContainerOptions): CliContainer {
  const paths: CliPaths = resolveCliPaths(process.env);
  const homePaths: StoryboardHomePaths = resolveStoryboardHomePaths();
  const workspaceRoot: NodeUri = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };

  const fileSystem: NodeFileSystem = new NodeFileSystem();
  const secretStore: SecretStore = new SecretStore(createFileSecretStorage(paths.secretsFile));
  const isWorkspace: boolean = existsSync(
    join(options.workspacePath, STORYBOARD_RELATIVE_PATHS.projectJson),
  );
  const workspaceConfigFile: string | undefined = isWorkspace
    ? resolveWorkspaceConfigFile(workspaceRoot.fsPath)
    : undefined;
  const configuration: FileConfiguration = createFileConfiguration({
    userConfigFile: paths.configFile,
    ...(workspaceConfigFile === undefined ? {} : { workspaceConfigFile }),
    overrides: createCommandLineConfigOverrides(options),
    onUnknownKey: (warning) => options.logger.warn(warning.message),
  });
  const configBridgeDependencies: ConfigBridgeDependencies = {
    getConfiguration: () => configuration,
    ...(options.configWriteTarget === undefined ? {} : { writeTarget: options.configWriteTarget }),
  };
  const configBridge: ConfigBridge =
    options.createConfigBridge?.(configBridgeDependencies) ??
    new ConfigBridge(configBridgeDependencies);

  const application: StoryboardApplication = new StoryboardApplication(
    {
      fileSystem,
      workspaceLocator: new NodeWorkspaceLocator(folder),
      logger: options.logger,
      secretStore,
      configBridge,
      ...(options.usageSink === undefined ? {} : { usageLedger: options.usageSink }),
      resourceRoots: [
        NodeUri.file(homePaths.home),
        getStoryboardProjectPaths(workspaceRoot).metadataDirectory,
      ],
    },
    {
      generator: `storyboard@${options.version}`,
      lockOwner: 'cli',
      ...(options.postGenerationUpdates === undefined
        ? {}
        : { postGenerationUpdates: options.postGenerationUpdates }),
    },
  );

  return {
    drafts: application.drafts,
    manuscript: application.manuscript,
    cards: application.cards,
    novel: application.novel,
    studio: application.studio,
    notes: application.notes,
    runGate: application.runGate,
    aiGateway: application.aiGateway,
    aiProviderRegistry: application.aiProviderRegistry,
    configBridge: application.configBridge,
    secretStore: application.secretStore,
    logger: application.logger,
    usageMeter: application.usageMeter,
    fileSystem,
    workspaceRoot,
    version: options.version,
    canPrompt: options.canPrompt,
    progress: options.progress ?? new LineRunProgress(options.logger),
    pauseRequests: options.pauseRequests ?? new PauseRequests(),
    ...(options.prompter === undefined ? {} : { prompter: options.prompter }),
    homePaths,
    loadResourceOverrides: () => application.loadResourceOverrides(),
    describeParameters: () => application.describeParameters(),
    describeWorkspace: () => application.describeWorkspace(workspaceRoot),
    workspaceConfigFile,
    configWriteFile:
      configuration.targetFile(options.configWriteTarget ?? configurationTargets.user) ??
      paths.configFile,
  };
}
