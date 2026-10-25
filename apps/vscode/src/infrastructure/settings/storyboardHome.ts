import type { DisposableHandle } from '@storyboard/story-model';
import * as vscode from 'vscode';

import type {
  StoryboardConfigurationChangeEventLike,
  StoryboardConfigurationLike,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';
import {
  createFileConfiguration,
  createFileSecretStorage,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
  watchFiles,
  type ConfigFileError,
  type ConfigKeyWarning,
  type FileConfiguration,
  type StoryboardHomePaths,
} from '@storyboard/story-config';

export interface StoryboardHomeStores extends vscode.Disposable {
  readonly paths: StoryboardHomePaths;
  readonly workspaceConfigFile: string | undefined;
  readonly configuration: StoryboardConfigurationLike;
  readonly secretStorage: StoryboardSecretStorageLike;
  readonly onDidChangeConfiguration: (
    listener: (event: StoryboardConfigurationChangeEventLike) => void,
  ) => vscode.Disposable;
}

export interface StoryboardHomeStoresOptions {
  readonly workspaceRoot: string | undefined;
  readonly onInvalidFile: (error: ConfigFileError) => void;
  readonly onUnknownKey?: (warning: ConfigKeyWarning) => void;
}

// The extension reads the same `~/.storyboard/config.json` (and `<workspace>/.storyboard/config.json`)
// the CLI reads, so a provider chosen in one app is the provider in both. A change
// made by another process reaches the panel through the file watcher; a change made here is
// announced right after the write so the UI never waits on the watcher's settle delay.
export function createStoryboardHomeStores(
  options: StoryboardHomeStoresOptions,
): StoryboardHomeStores {
  const paths: StoryboardHomePaths = resolveStoryboardHomePaths();
  const workspaceConfigFile: string | undefined =
    options.workspaceRoot === undefined
      ? undefined
      : resolveWorkspaceConfigFile(options.workspaceRoot);
  const changeEmitter: vscode.EventEmitter<StoryboardConfigurationChangeEventLike> =
    new vscode.EventEmitter<StoryboardConfigurationChangeEventLike>();
  const changeEvent: StoryboardConfigurationChangeEventLike = { affectsConfiguration: () => true };

  const fileConfiguration: FileConfiguration = createFileConfiguration({
    userConfigFile: paths.configFile,
    workspaceConfigFile,
    onInvalidFile: options.onInvalidFile,
    ...(options.onUnknownKey === undefined ? {} : { onUnknownKey: options.onUnknownKey }),
  });

  const configuration: StoryboardConfigurationLike = {
    get: fileConfiguration.get,
    inspect: fileConfiguration.inspect,
    update: async (section, value, target) => {
      await fileConfiguration.update(section, value, target);
      changeEmitter.fire(changeEvent);
    },
  };

  const watcher: DisposableHandle = watchFiles(
    [paths.configFile, ...(workspaceConfigFile === undefined ? [] : [workspaceConfigFile])],
    () => changeEmitter.fire(changeEvent),
  );

  return {
    paths,
    workspaceConfigFile,
    configuration,
    secretStorage: createFileSecretStorage(paths.secretsFile),
    onDidChangeConfiguration: (listener) => changeEmitter.event(listener),
    dispose: (): void => {
      watcher.dispose();
      changeEmitter.dispose();
    },
  };
}
