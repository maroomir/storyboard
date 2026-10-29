import { aiProviderIds, type AiProviderId } from '@storyboard/story-model';
import { createApiKeySecretKey } from '@storyboard/story-ai';
import type {
  ConfigurationInspection,
  StoryboardConfigurationLike,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';
import { configurationTargets } from '@storyboard/story-config';

interface LegacySettingMigration {
  readonly legacy: string;
  readonly home: string;
}

const legacySettingMigrations: readonly LegacySettingMigration[] = [
  { legacy: 'defaultProvider', home: 'ai.provider.default' },
  { legacy: 'providers.openai.model', home: 'providers.openai.model' },
  { legacy: 'providers.claude.model', home: 'providers.claude.model' },
  { legacy: 'providers.google.model', home: 'providers.google.model' },
  { legacy: 'providers.ollama.baseUrl', home: 'providers.ollama.baseUrl' },
  { legacy: 'providers.ollama.model', home: 'providers.ollama.model' },
  { legacy: 'tasks', home: 'tasks' },
  { legacy: 'grammar.realtimeEnabled', home: 'editor.grammar.realtime' },
  { legacy: 'slop.realtimeEnabled', home: 'editor.slop.realtime' },
  { legacy: 'ai.contextCondenseEnabled', home: 'generation.context.condense' },
  { legacy: 'scene.prefixDigits', home: 'editor.scene.prefixDigits' },
  { legacy: 'draft.reviseMaxIterations', home: 'revise.loop.maxIterations' },
  { legacy: 'draft.reviseAfterGenerate', home: 'revise.loop.afterGenerate' },
  { legacy: 'draft.reviseScoreThreshold', home: 'revise.loop.scoreThreshold' },
  { legacy: 'draft.maxCompressionPercent', home: 'revise.length.maxCompressionPercent' },
  { legacy: 'draft.updateCardsAfterGenerate', home: 'cards.candidates.updateAfterGenerate' },
  { legacy: 'draft.verifyCardCandidates', home: 'cards.candidates.verify' },
  { legacy: 'grounding.autoApprove', home: 'generation.grounding.autoApprove' },
  { legacy: 'studio.validation', home: 'editor.studio.validation' },
  { legacy: 'draft.keepHistory', home: 'editor.draft.keepHistory' },
  { legacy: 'draft.sceneBreakEnabled', home: 'generation.sceneBreak.enabled' },
  { legacy: 'draft.sceneBreakSeparator', home: 'generation.sceneBreak.separator' },
];

export const legacyVscodeSettingKeys: readonly string[] = legacySettingMigrations.map(
  (entry) => entry.legacy,
);

export interface LegacySettingInspection<T> {
  readonly globalValue?: T;
  readonly workspaceValue?: T;
}

export interface LegacyVscodeConfigurationLike {
  readonly inspect: <T>(section: string) => LegacySettingInspection<T> | undefined;
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

export async function migrateVscodeSettingsToHome(
  deps: MigrateVscodeSettingsDependencies,
): Promise<MigrateVscodeSettingsResult> {
  const movedSettings: string[] = [];

  for (const migration of legacySettingMigrations) {
    movedSettings.push(...(await migrateLegacySetting(deps, migration)));
  }

  const movedApiKeys: string[] = [];

  for (const providerId of aiProviderIds) {
    if (await migrateLegacyApiKey(deps, providerId)) {
      movedApiKeys.push(providerId);
    }
  }

  return { movedSettings, movedApiKeys };
}

async function migrateLegacySetting(
  deps: MigrateVscodeSettingsDependencies,
  { legacy: legacyKey, home: homeKey }: LegacySettingMigration,
): Promise<string[]> {
  const legacy: LegacySettingInspection<unknown> | undefined =
    deps.vscodeConfiguration.inspect<unknown>(legacyKey);

  if (!legacy) {
    return [];
  }

  const home: ConfigurationInspection<unknown> | undefined =
    deps.homeConfiguration.inspect?.<unknown>(homeKey);
  const movedSettings: string[] = [];

  if (legacy.globalValue !== undefined) {
    if (home?.globalValue === undefined) {
      await deps.homeConfiguration.update?.(homeKey, legacy.globalValue, configurationTargets.user);
    }

    await deps.vscodeConfiguration.update(legacyKey, undefined, configurationTargets.user);
    movedSettings.push(homeKey);
  }

  if (legacy.workspaceValue !== undefined && deps.hasWorkspaceConfigFile) {
    if (home?.workspaceValue === undefined) {
      await deps.homeConfiguration.update?.(
        homeKey,
        legacy.workspaceValue,
        configurationTargets.workspace,
      );
    }

    await deps.vscodeConfiguration.update(legacyKey, undefined, configurationTargets.workspace);
    movedSettings.push(homeKey);
  }

  return movedSettings;
}

async function migrateLegacyApiKey(
  deps: MigrateVscodeSettingsDependencies,
  providerId: AiProviderId,
): Promise<boolean> {
  const secretKey: string = createApiKeySecretKey(providerId);
  const legacyApiKey: string | undefined = await deps.vscodeSecrets.get(secretKey);

  if (legacyApiKey === undefined) {
    return false;
  }

  if ((await deps.homeSecrets.get(secretKey)) === undefined) {
    await deps.homeSecrets.store(secretKey, legacyApiKey);
  }

  await deps.vscodeSecrets.delete(secretKey);
  return true;
}
