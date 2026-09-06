import {
  aiTaskNames,
  isCliProvider,
  type AiProviderId,
  type ConfigBridge,
} from '@storyboard/story-ai';
import type { StoryboardConfigurationLike } from '@storyboard/story-ai';
import {
  configurationTargets,
  createFileConfiguration,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
} from '@storyboard/story-config';

import type { DraftConfig, ProvidersConfig } from './config';

export interface BotConfigurationOptions {
  readonly workspacePath: string;
  readonly providers?: ProvidersConfig | undefined;
  readonly draft?: DraftConfig | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

// Flattens the legacy `bot.json` blocks into the dotted keys the shared config uses. They ride as
// overrides so an install that has not moved them yet behaves exactly as before; the boot warning
// tells the operator to move them.
export function flattenLegacyBlocks(
  providers: ProvidersConfig | undefined,
  draft: DraftConfig | undefined,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (providers?.default !== undefined) {
    overrides['defaultProvider'] = providers.default;
  }
  if (providers?.tasks !== undefined) {
    overrides['tasks'] = providers.tasks;
  }
  for (const [providerId, section] of Object.entries(providers?.models ?? {})) {
    for (const key of ['model', 'command', 'timeoutMs', 'reasoningEffort'] as const) {
      if (section[key] !== undefined) {
        overrides[`providers.${providerId}.${key}`] = section[key];
      }
    }
  }

  if (draft !== undefined) {
    overrides['draft.reviseAfterGenerate'] = draft.reviseAfterGenerate;
    overrides['draft.reviseMaxIterations'] = draft.reviseMaxIterations;
    overrides['grounding.autoApprove'] = draft.autoGrounding;
  }

  return overrides;
}

// The same two layers the extension and the CLI read: the home file, then the workspace's own
// `.storyboard/config.json` for the workspace this bot edits.
export function createBotConfiguration(
  options: BotConfigurationOptions,
): StoryboardConfigurationLike {
  const home = resolveStoryboardHomePaths(options.env);

  return createFileConfiguration({
    userConfigFile: home.configFile,
    workspaceConfigFile: resolveWorkspaceConfigFile(options.workspacePath),
    overrides: flattenLegacyBlocks(options.providers, options.draft),
  });
}

export async function writeSharedDefaultProvider(
  providerId: AiProviderId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const home = resolveStoryboardHomePaths(env);
  const configuration = createFileConfiguration({ userConfigFile: home.configFile });

  await configuration.update('defaultProvider', providerId, configurationTargets.user);
  return home.configFile;
}

// A provider is "in use" when it is the default or any task points at it; the doctor checks each
// one — a CLI provider's binary on PATH, an API-key provider's key in the shared secrets file.
export function listProvidersInUse(configBridge: ConfigBridge): readonly AiProviderId[] {
  const providerIds = new Set<AiProviderId>();

  if (configBridge.isDefaultProviderConfigured()) {
    providerIds.add(configBridge.getDefaultProvider());
  }
  for (const taskName of aiTaskNames) {
    const override = configBridge.getTaskProviderOverride(taskName);
    if (override !== null) {
      providerIds.add(override);
    }
  }

  return [...providerIds];
}

export function listCliProvidersInUse(
  configBridge: ConfigBridge,
): ReadonlyArray<{ readonly providerId: AiProviderId; readonly command: string }> {
  return listProvidersInUse(configBridge)
    .filter((providerId) => isCliProvider(providerId))
    .map((providerId) => ({
      providerId,
      command: configBridge.getProviderConfig(providerId).command ?? providerId,
    }));
}
