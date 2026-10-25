import {
  findStoryboardSetting,
  isValidStoryboardSettingValue,
  providerCatalog,
  requiresApiKey,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type StoryboardSettingDefinition,
} from '@storyboard/story-model';
import {
  ConfigBridge,
  createAiProviderRegistry,
  SecretStore,
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

const basicSettingKeys: Set<string> = new Set(['budget.run.limitUsd', 'revise.loop.afterGenerate', 'editor.draft.keepHistory']);

const workspaceScopedSettingKeys: Set<string> = new Set(['budget.run.limitUsd']);

export interface SettingsStores {
  readonly configuration: FileConfiguration;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly aiProviderRegistry: AiProviderRegistry;
}

export function createHomeSettingsStores(
  homePaths: StoryboardHomePaths,
  onInvalidConfigFile: (error: ConfigFileError) => void,
): SettingsStores {
  const configuration: FileConfiguration = createFileConfiguration({
    userConfigFile: homePaths.configFile,
    onInvalidFile: onInvalidConfigFile,
  });
  const configBridge: ConfigBridge = new ConfigBridge({
    getConfiguration: () => configuration,
    writeTarget: configurationTargets.user,
  });
  const secretStore: SecretStore = new SecretStore(createFileSecretStorage(homePaths.secretsFile));
  const aiProviderRegistry: AiProviderRegistry = createAiProviderRegistry({
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

function isProviderShownToWriters(providerId: AiProviderId): boolean {
  const isFakeDraftProvider: boolean = providerId === 'mock';
  return !isFakeDraftProvider;
}

export class SettingsService {
  public constructor(private readonly dependencies: SettingsServiceDependencies) {}

  public isProviderReady(): boolean {
    return this.dependencies.stores().configBridge.isDefaultProviderConfigured();
  }

  public async read(): Promise<DesktopSettings> {
    const { configBridge, secretStore } = this.dependencies.stores();
    const defaultProvider: AiProviderId | undefined = configBridge.isDefaultProviderConfigured()
      ? configBridge.getDefaultProvider()
      : undefined;
    const providers: ProviderOption[] = [];

    for (const id of configBridge.getAvailableProviderIds().filter(isProviderShownToWriters)) {
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
      hasNotionToken: (await secretStore.getNotionToken()) !== undefined,
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

  public async connectNotion(token: string): Promise<DesktopSettings> {
    await this.dependencies.stores().secretStore.setNotionToken(token);
    return await this.read();
  }

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
      const reason: string = error instanceof Error ? error.message : String(error);
      return fail('provider-rejected', this.dependencies.translate('error.keyUnverified', { reason }));
    }
  }

  public async setValue(key: string, value: boolean | number | string): Promise<ServiceResult<DesktopSettings>> {
    const definition: StoryboardSettingDefinition | undefined = findStoryboardSetting(key);

    if (definition === undefined || !isValidStoryboardSettingValue(definition, value)) {
      return fail('invalid-request', this.dependencies.translate('error.invalidRequest'));
    }

    const isWorkspaceScoped: boolean = workspaceScopedSettingKeys.has(key) && this.dependencies.hasOpenWorkspace();
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
