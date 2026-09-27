import {
  NodeUri,
  type StoryUri,
  type StoryWorkspaceFolder,
  type IUsageSink,
} from '@storyboard/story-engine';
import { StoryboardApplication, type StoryboardServices } from '@storyboard/story-app';
import { ConfigBridge, type ConfigBridgeDependencies, SecretStore } from '@storyboard/story-ai';

import type { IStoryboardLogger } from '@storyboard/story-engine';

import { NodeFileSystem, NodeWorkspaceLocator } from '@storyboard/story-node';
import { resolveCliPaths } from './adapters/paths';
import {
  configurationTargets,
  createFileConfiguration,
  createFileSecretStorage,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
  type ConfigurationTarget,
  type StoryboardHomePaths,
} from '@storyboard/story-config';

export interface CliContainer extends StoryboardServices {
  readonly workspaceRoot: StoryUri;
  readonly homePaths: StoryboardHomePaths;
  readonly workspaceConfigFile: string | undefined;
  // The file `setup`/`config set` write to on this run: the workspace's unless --global was given.
  readonly configWriteFile: string;
  // False inside the TUI, where stdin belongs to the screen and a readline prompt would fight it.
  readonly canPrompt: boolean;
  readonly fileSystem: NodeFileSystem;
  // 측정 결과가 «무엇으로 쟀는지» 를 적으려면 실행한 버전을 되돌려 줘야 한다.
  readonly version: string;
}

export interface CliContainerOptions {
  readonly workspacePath: string;
  readonly logger: IStoryboardLogger;
  readonly canPrompt: boolean;
  readonly version: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reviseMaxIterations?: number;
  // Which config file `setup`/`config set` write to. Decided from the run's location and
  // `--global` before the container exists, so every writer here agrees on one answer.
  readonly configWriteTarget?: ConfigurationTarget;
  // A caller that must account for every token brings its own ledger. A terminal run keeps the
  // no-op: there is no usage panel to feed.
  readonly usageSink?: IUsageSink;
  // Lets a measurement harness layer fixed generation knobs over the configured ones without the
  // engine learning that a harness exists.
  readonly createConfigBridge?: (dependencies: ConfigBridgeDependencies) => ConfigBridge;
  // Post-generation card updates rewrite the workspace's cards in unawaited background jobs. A
  // measurement run must leave its fixture byte-identical and must not have those tokens land
  // after the run is scored.
  readonly postGenerationUpdates?: boolean;
  // A local runtime's address and usable context window. Machine properties, so a measurement
  // profile hands them in per run instead of writing them into the fixture's own config.
  readonly localRuntime?: {
    readonly baseUrl?: string;
    readonly contextTokens?: number;
    readonly think?: boolean;
  };
  // Forces one prompt variant for every task. A measurement harness uses it to separate the
  // model's own ceiling from the compact prompt local models are routed to by name.
  readonly promptVariant?: 'generic' | 'xs' | 'rich';
}

// `--provider`/`--model` are the terminal's form of the settings the extension keeps in its UI, so
// they are layered onto the config rather than threaded through every call.
function configOverrides(options: CliContainerOptions): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (options.provider !== undefined) {
    overrides['defaultProvider'] = options.provider;
    // Task-level routing in the config file beats `defaultProvider`, so a `--provider` that only
    // set the default would silently lose to a `tasks.sceneDraft.provider` the user configured.
    // Naming a provider on the command line means "this run, everything".
    overrides['tasks'] = {};

    if (options.model !== undefined) {
      overrides[`providers.${options.provider}.model`] = options.model;
    }
  }

  if (options.reviseMaxIterations !== undefined) {
    overrides['draft.reviseMaxIterations'] = options.reviseMaxIterations;
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
    overrides['promptVariant'] = options.promptVariant;
  }

  return overrides;
}

// The CLI's side of the composition: only the host adapters are built here. The engine graph they
// feed is assembled once, for every app, by StoryboardApplication.
export function createCliContainer(options: CliContainerOptions): CliContainer {
  const paths = resolveCliPaths(process.env);
  const workspaceRoot = NodeUri.file(options.workspacePath);
  const folder: StoryWorkspaceFolder = { uri: workspaceRoot, name: 'workspace' };

  const fileSystem = new NodeFileSystem();
  const secretStore = new SecretStore(createFileSecretStorage(paths.secretsFile));
  const workspaceConfigFile = resolveWorkspaceConfigFile(workspaceRoot.fsPath);
  const configuration = createFileConfiguration({
    userConfigFile: paths.configFile,
    workspaceConfigFile,
    overrides: configOverrides(options),
  });
  const configBridgeDependencies: ConfigBridgeDependencies = {
    getConfiguration: () => configuration,
    ...(options.configWriteTarget === undefined ? {} : { writeTarget: options.configWriteTarget }),
  };
  const configBridge =
    options.createConfigBridge?.(configBridgeDependencies) ??
    new ConfigBridge(configBridgeDependencies);

  // The CLI has no usage panel; the ledger the extension keeps is not worth a file write here, so
  // cost is reported per run instead of persisted.
  const application = new StoryboardApplication(
    {
      fileSystem,
      workspaceLocator: new NodeWorkspaceLocator(folder),
      logger: options.logger,
      secretStore,
      configBridge,
      ...(options.usageSink === undefined ? {} : { usageLedger: options.usageSink }),
    },
    {
      generator: `storyboard@${options.version}`,
      ...(options.postGenerationUpdates === undefined
        ? {}
        : { postGenerationUpdates: options.postGenerationUpdates }),
    },
  );

  return {
    ...application.services,
    fileSystem,
    workspaceRoot,
    version: options.version,
    canPrompt: options.canPrompt,
    homePaths: resolveStoryboardHomePaths(),
    workspaceConfigFile,
    configWriteFile:
      configuration.targetFile(options.configWriteTarget ?? configurationTargets.user) ??
      paths.configFile,
  };
}
