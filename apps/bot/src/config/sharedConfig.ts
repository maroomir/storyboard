import {
  aiProviderIds,
  aiTaskNames,
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

import { ConfigError, type DraftConfig, type ProvidersConfig } from './config';

// The bot runs CLI providers only (decision #22/#33): API-key providers would need keys the bot
// never holds, so a shared config that names one is refused at boot rather than at job time.
export const botProviderIds = ['mock', 'claude-code', 'codex'] as const;
export type BotProviderId = (typeof botProviderIds)[number];

export function isBotProviderId(value: string): value is BotProviderId {
  return (botProviderIds as readonly string[]).includes(value);
}

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
  providerId: BotProviderId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const home = resolveStoryboardHomePaths(env);
  const configuration = createFileConfiguration({ userConfigFile: home.configFile });

  await configuration.update('defaultProvider', providerId, configurationTargets.user);
  return home.configFile;
}

export function assertBotProviderSelection(configBridge: ConfigBridge): void {
  const offending: string[] = [];

  if (configBridge.isDefaultProviderConfigured()) {
    const providerId = configBridge.getDefaultProvider();
    if (!isBotProviderId(providerId)) {
      offending.push(`defaultProvider=${providerId}`);
    }
  }

  for (const taskName of aiTaskNames) {
    const override = configBridge.getTaskProviderOverride(taskName);
    if (override !== null && !isBotProviderId(override)) {
      offending.push(`tasks.${taskName}=${override}`);
    }
  }

  if (offending.length > 0) {
    throw new ConfigError(
      'invalid-schema',
      `봇은 CLI 프로바이더만 씁니다 (${botProviderIds.join(', ')}). 공통 설정의 다음 항목을 바꿔 주세요: ${offending.join(', ')} (API 키 프로바이더 ${aiProviderIds.filter((id) => !isBotProviderId(id)).join('·')}는 봇에서 지원하지 않습니다)`,
    );
  }
}

// A CLI provider is "in use" when it is the default or any task points at it; the doctor checks
// that each one's binary is on PATH.
export function listCliProvidersInUse(
  configBridge: ConfigBridge,
): ReadonlyArray<{ readonly providerId: 'claude-code' | 'codex'; readonly command: string }> {
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

  return [...providerIds]
    .filter((id): id is 'claude-code' | 'codex' => id === 'claude-code' || id === 'codex')
    .map((providerId) => ({
      providerId,
      command: configBridge.getProviderConfig(providerId).command ?? providerId,
    }));
}
