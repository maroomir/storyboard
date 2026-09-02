import { aiProviderIds, createApiKeySecretKey } from '@storyboard/story-ai';
import type {
  StoryboardConfigurationLike,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';
import { configurationTargets } from '@storyboard/story-config';

// Every `storyboard.*` key the extension used to contribute to VSCode settings. They keep their
// names in `config.json`, minus the prefix, so the list doubles as the migration manifest.
export const legacyVscodeSettingKeys = [
  'defaultProvider',
  'providers.openai.model',
  'providers.claude.model',
  'providers.google.model',
  'providers.ollama.baseUrl',
  'providers.ollama.model',
  'providers.claude-code.command',
  'providers.claude-code.model',
  'providers.claude-code.timeoutMs',
  'providers.codex.command',
  'providers.codex.model',
  'providers.codex.timeoutMs',
  'providers.codex.reasoningEffort',
  'tasks',
  'grammar.realtimeEnabled',
  'slop.realtimeEnabled',
  'ai.contextCondenseEnabled',
  'scene.prefixDigits',
  'draft.reviseMaxIterations',
  'draft.reviseAfterGenerate',
  'draft.reviseScoreThreshold',
  'draft.maxCompressionPercent',
  'draft.updateCardsAfterGenerate',
  'draft.verifyCardCandidates',
  'grounding.autoApprove',
  'studio.validation',
  'draft.keepHistory',
  'draft.sceneBreakEnabled',
  'draft.sceneBreakSeparator',
] as const;

export interface LegacyVscodeConfigurationLike {
  readonly inspect: <T>(
    section: string,
  ) => { readonly globalValue?: T; readonly workspaceValue?: T } | undefined;
  readonly update: (section: string, value: undefined, target: number) => PromiseLike<void>;
}

export interface MigrateVscodeSettingsDependencies {
  readonly vscodeConfiguration: LegacyVscodeConfigurationLike;
  readonly vscodeSecrets: Pick<StoryboardSecretStorageLike, 'get' | 'delete'>;
  readonly homeConfiguration: StoryboardConfigurationLike;
  readonly homeSecrets: StoryboardSecretStorageLike;
  readonly hasWorkspaceConfigFile: boolean;
}

export interface MigrateVscodeSettingsResult {
  readonly movedSettings: readonly string[];
  readonly movedApiKeys: readonly string[];
}

// One-way, one-time: a value found in VSCode settings is copied into the layer of `config.json`
// that matches its scope — unless that layer already holds the key, because a value the author
// set in the shared file after the move is the newer one — and then removed from VSCode settings
// so it cannot come back as a stale duplicate on the next activation.
export async function migrateVscodeSettingsToHome(
  deps: MigrateVscodeSettingsDependencies,
): Promise<MigrateVscodeSettingsResult> {
  const movedSettings: string[] = [];

  for (const key of legacyVscodeSettingKeys) {
    const legacy = deps.vscodeConfiguration.inspect<unknown>(key);

    if (!legacy) {
      continue;
    }

    const home = deps.homeConfiguration.inspect?.<unknown>(key);

    if (legacy.globalValue !== undefined) {
      if (home?.globalValue === undefined) {
        await deps.homeConfiguration.update?.(key, legacy.globalValue, configurationTargets.user);
      }

      await deps.vscodeConfiguration.update(key, undefined, configurationTargets.user);
      movedSettings.push(key);
    }

    if (legacy.workspaceValue !== undefined && deps.hasWorkspaceConfigFile) {
      if (home?.workspaceValue === undefined) {
        await deps.homeConfiguration.update?.(
          key,
          legacy.workspaceValue,
          configurationTargets.workspace,
        );
      }

      await deps.vscodeConfiguration.update(key, undefined, configurationTargets.workspace);
      movedSettings.push(key);
    }
  }

  const movedApiKeys: string[] = [];

  for (const providerId of aiProviderIds) {
    const secretKey = createApiKeySecretKey(providerId);
    const legacyApiKey = await deps.vscodeSecrets.get(secretKey);

    if (legacyApiKey === undefined) {
      continue;
    }

    if ((await deps.homeSecrets.get(secretKey)) === undefined) {
      await deps.homeSecrets.store(secretKey, legacyApiKey);
    }

    await deps.vscodeSecrets.delete(secretKey);
    movedApiKeys.push(providerId);
  }

  return { movedSettings, movedApiKeys };
}
