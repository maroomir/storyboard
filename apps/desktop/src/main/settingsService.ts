import {
  aiProviderIds,
  ConfigBridge,
  createAiProviderRegistry,
  findStoryboardSetting,
  isValidStoryboardSettingValue,
  providerCatalog,
  requiresApiKey,
  SecretStore,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type AiProviderRegistry,
} from '@storyboard/story-ai';
import {
  configurationTargets,
  createFileConfiguration,
  createFileSecretStorage,
  type ConfigFileError,
  type FileConfiguration,
  type StoryboardHomePaths,
} from '@storyboard/story-config';

import type { DesktopSettings, ProviderOption, SettingEntry, UiLanguage } from '@/shared/dto';
import type { MessageKey, MessageParams } from '@/shared/i18n/translate';

import { fail, succeed, type ServiceResult } from './serviceResult';

// Shown on the settings screen's first section; the rest of the catalog sits under "advanced".
const basicSettingKeys = new Set(['budget.runLimitUsd', 'draft.reviseAfterGenerate', 'draft.keepHistory']);

// A value one work needs differently from another. Everything else is the writer's habit and follows
// them into every work, like the provider and the model.
const workspaceScopedSettingKeys = new Set(['budget.runLimitUsd']);

export interface SettingsStores {
  readonly configuration: FileConfiguration;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly aiProviderRegistry: AiProviderRegistry;
}

// Before a work is open the settings screen still has to work (the first run asks for a key), so
// the stores can also be built from the home files alone.
export function createHomeSettingsStores(
  homePaths: StoryboardHomePaths,
  onInvalidConfigFile: (error: ConfigFileError) => void,
): SettingsStores {
  const configuration = createFileConfiguration({
    userConfigFile: homePaths.configFile,
    onInvalidFile: onInvalidConfigFile,
  });
  const configBridge = new ConfigBridge({
    getConfiguration: () => configuration,
    writeTarget: configurationTargets.user,
  });
  const secretStore = new SecretStore(createFileSecretStorage(homePaths.secretsFile));
  const aiProviderRegistry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: true,
  });

  return { configuration, configBridge, secretStore, aiProviderRegistry };
}

export interface SettingsServiceDependencies {
  readonly stores: () => SettingsStores;
  readonly hasOpenWorkspace: () => boolean;
  readonly language: () => UiLanguage;
  readonly translate: (key: MessageKey, params?: MessageParams) => string;
}

export class SettingsService {
  public constructor(private readonly dependencies: SettingsServiceDependencies) {}

  public isProviderReady(): boolean {
    return this.dependencies.stores().configBridge.isDefaultProviderConfigured();
  }

  public async read(): Promise<DesktopSettings> {
    const { configBridge, secretStore } = this.dependencies.stores();
    const defaultProvider = configBridge.isDefaultProviderConfigured()
      ? configBridge.getDefaultProvider()
      : undefined;
    const providers: ProviderOption[] = [];

    // NOTE: mock 은 작가에게 보이지 않는다. 가짜 원고를 진짜처럼 저장하는 선택지이기 때문이다.
    for (const id of aiProviderIds.filter((candidate) => candidate !== 'mock')) {
      providers.push({
        id,
        label: providerCatalog[id].displayName,
        requiresApiKey: requiresApiKey(id),
        hasApiKey: await secretStore.hasApiKey(id),
        model: configBridge.getProviderConfig(id).model ?? providerCatalog[id].defaultModel ?? '',
        models: storyboardModelCatalog[id].map((model) => ({ id: model.id, label: model.displayName })),
        isAdvanced: !requiresApiKey(id),
      });
    }

    const entries: SettingEntry[] = storyboardSettingCatalog.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      value: configBridge.getSettingValue(definition.key),
      ...(definition.minimum === undefined ? {} : { minimum: definition.minimum }),
      ...(definition.maximum === undefined ? {} : { maximum: definition.maximum }),
      isBasic: basicSettingKeys.has(definition.key),
    }));

    return {
      ...(defaultProvider === undefined ? {} : { defaultProvider }),
      providers,
      entries,
      language: this.dependencies.language(),
      ollamaBaseUrl: configBridge.getProviderConfig('ollama').baseUrl ?? '',
    };
  }

  public async setDefaultProvider(providerId: AiProviderId): Promise<DesktopSettings> {
    await this.dependencies.stores().configBridge.setDefaultProvider(providerId);
    return await this.read();
  }

  public async setModel(providerId: AiProviderId, model: string): Promise<DesktopSettings> {
    await this.dependencies.stores().configBridge.setProviderModel(providerId, model);
    return await this.read();
  }

  public async setOllamaBaseUrl(baseUrl: string): Promise<DesktopSettings> {
    await this.dependencies.stores().configBridge.setProviderBaseUrl(baseUrl);
    return await this.read();
  }

  // Stores the key, then calls the service once, so a mistyped key shows up now rather than on
  // the first paid call. The first key also becomes the service in use. SECURITY: the key is
  // never logged or sent back; only whether one is stored is.
  public async setApiKey(providerId: AiProviderId, apiKey: string): Promise<ServiceResult<DesktopSettings>> {
    const { configBridge, secretStore, aiProviderRegistry } = this.dependencies.stores();

    await secretStore.setApiKey(providerId, apiKey);

    if (!configBridge.isDefaultProviderConfigured()) {
      await configBridge.setDefaultProvider(providerId);
    }

    try {
      await aiProviderRegistry.checkConnection(providerId);
      return succeed(await this.read());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail('provider-rejected', this.dependencies.translate('error.keyUnverified', { reason }));
    }
  }

  public async setValue(key: string, value: boolean | number | string): Promise<ServiceResult<DesktopSettings>> {
    const definition = findStoryboardSetting(key);

    if (definition === undefined || !isValidStoryboardSettingValue(definition, value)) {
      return fail('invalid-request', this.dependencies.translate('error.invalidRequest'));
    }

    const isWorkspaceScoped = workspaceScopedSettingKeys.has(key) && this.dependencies.hasOpenWorkspace();
    await this.dependencies
      .stores()
      .configuration.update(
        key,
        value,
        isWorkspaceScoped ? configurationTargets.workspace : configurationTargets.user,
      );

    return succeed(await this.read());
  }
}
