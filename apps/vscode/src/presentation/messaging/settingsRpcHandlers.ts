import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardResponsePayload,
  AiTaskName,
  AiProviderStatus,
  AiProviderId,
  ProviderModelOptions,
  ConfigValueOrigin,
  SettingsConfigFiles,
} from '@storyboard/story-model';
import {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskNames,
  storyboardModelCatalog,
  storyboardSettingCatalog,
} from '@storyboard/story-model';
import type {
  AiProviderRegistry,
  ConfigBridge,
  ProviderModelConfig,
  SecretStore,
  TaskAiConfigOverride,
} from '@storyboard/story-ai';

export interface SettingsRpcHandlersDependencies {
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly registry: AiProviderRegistry;
  readonly configFiles: () => SettingsConfigFiles;
}

export class SettingsRpc {
  public constructor(private readonly deps: SettingsRpcHandlersDependencies) {}

  public readSnapshot(): Promise<StoryboardResponsePayload<'settings.read'>> {
    return this.buildSettingsReadSnapshot();
  }

  public handlers(): StoryboardRpcHandlers {
    const { configBridge, secretStore } = this.deps;
    const savedTo = (key: string): StoryboardResponsePayload<'settings.updateDefaultProvider'> =>
      this.describeSaveTarget(key);

    return {
      'settings.read': async (): Promise<StoryboardResponsePayload<'settings.read'>> =>
        this.buildSettingsReadSnapshot(),

      'settings.updateDefaultProvider': async (
        payload,
      ): Promise<StoryboardResponsePayload<'settings.updateDefaultProvider'>> => {
        await configBridge.setDefaultProvider(payload.providerId);
        return savedTo('ai.provider.default');
      },

      'settings.updateProviderModel': async (
        payload,
      ): Promise<StoryboardResponsePayload<'settings.updateProviderModel'>> => {
        await configBridge.setProviderModel(payload.providerId, payload.model);
        return savedTo(`providers.${payload.providerId}.model`);
      },

      'settings.updateProviderBaseUrl': async (
        payload,
      ): Promise<StoryboardResponsePayload<'settings.updateProviderBaseUrl'>> => {
        await configBridge.setProviderBaseUrl(payload.baseUrl);
        return savedTo('providers.ollama.baseUrl');
      },

      'settings.updateTaskAiConfig': async (
        payload,
      ): Promise<StoryboardResponsePayload<'settings.updateTaskAiConfig'>> => {
        await configBridge.setTaskAiConfig(payload.taskName, {
          providerId: payload.providerId,
          model: payload.model,
        });
        return savedTo('tasks');
      },

      'settings.updateSettingValue': async (
        payload,
      ): Promise<StoryboardResponsePayload<'settings.updateSettingValue'>> => {
        await configBridge.setSettingValue(payload.key, payload.value);
        return savedTo(payload.key);
      },

      'secrets.writeApiKey': async (
        payload,
      ): Promise<StoryboardResponsePayload<'secrets.writeApiKey'>> => {
        await secretStore.setApiKey(payload.providerId, payload.apiKey);
        return { hasApiKey: true };
      },

      'secrets.deleteApiKey': async (
        payload,
      ): Promise<StoryboardResponsePayload<'secrets.deleteApiKey'>> => {
        await secretStore.deleteApiKey(payload.providerId);
        return { hasApiKey: false };
      },
    };
  }

  private describeSaveTarget(
    key: string,
  ): StoryboardResponsePayload<'settings.updateDefaultProvider'> {
    const origin: ConfigValueOrigin = this.deps.configBridge.getValueOrigin(key);
    const files: SettingsConfigFiles = this.deps.configFiles();
    const file: string | undefined = origin === 'workspace' ? files.workspace : files.user;

    return { origin, ...(file === undefined ? {} : { file }) };
  }

  private async buildSettingsReadSnapshot(): Promise<StoryboardResponsePayload<'settings.read'>> {
    const { configBridge, registry } = this.deps;
    const providers: AiProviderStatus[] = await registry.listProviders();
    const defaultProvider: AiProviderId = configBridge.getDefaultProvider();

    const providerConfigs: StoryboardResponsePayload<'settings.read'>['providerConfigs'] =
      this.buildProviderConfigsPayload();
    const taskAssignments: StoryboardResponsePayload<'settings.read'>['taskAssignments'] =
      this.buildTaskAssignmentsPayload();

    const modelCatalog: StoryboardResponsePayload<'settings.read'>['modelCatalog'] =
      Object.fromEntries(
        aiProviderIds.map((id) => [id, [...storyboardModelCatalog[id]]]),
      ) as StoryboardResponsePayload<'settings.read'>['modelCatalog'];

    return {
      defaultProvider,
      isDefaultProviderConfigured: configBridge.isDefaultProviderConfigured(),
      providers,
      providerConfigs,
      taskAssignments,
      modelCatalog,
      taskCatalog: aiTaskCatalog.map((task) => ({
        name: task.name,
        label: task.label,
      })),
      origins: Object.fromEntries(
        originTrackedKeys.map((key) => [key, configBridge.getValueOrigin(key)]),
      ),
      configFiles: this.deps.configFiles(),
      settingCatalog: storyboardSettingCatalog.map((entry) => ({ ...entry })),
      settingValues: Object.fromEntries(
        storyboardSettingCatalog.map((entry) => [
          entry.key,
          configBridge.getSettingValue(entry.key),
        ]),
      ),
    };
  }

  private buildProviderConfigsPayload(): StoryboardResponsePayload<'settings.read'>['providerConfigs'] {
    const providerConfigs: StoryboardResponsePayload<'settings.read'>['providerConfigs'] =
      {} as StoryboardResponsePayload<'settings.read'>['providerConfigs'];

    for (const id of aiProviderIds) {
      const runtime: ProviderModelConfig = this.deps.configBridge.getProviderConfig(id);
      const catalog: ProviderModelOptions = storyboardModelCatalog[id];
      const model: string = resolveConfiguredModel(runtime.model, catalog[0].id);

      if (id === 'ollama') {
        const baseUrl: string | undefined = runtime.baseUrl?.trim();
        providerConfigs[id] =
          baseUrl !== undefined && baseUrl.length > 0 ? { model, baseUrl } : { model };
      } else {
        providerConfigs[id] = { model };
      }
    }

    return providerConfigs;
  }

  private buildTaskAssignmentsPayload(): StoryboardResponsePayload<'settings.read'>['taskAssignments'] {
    return Object.fromEntries(
      aiTaskNames.map((taskName: AiTaskName) => {
        const override: TaskAiConfigOverride | null =
          this.deps.configBridge.getTaskAiConfigOverride(taskName);
        const entry: StoryboardResponsePayload<'settings.read'>['taskAssignments'][AiTaskName] =
          override === null
            ? { providerId: null, model: null }
            : { providerId: override.providerId, model: override.model };

        return [taskName, entry];
      }),
    ) as StoryboardResponsePayload<'settings.read'>['taskAssignments'];
  }
}

const originTrackedKeys: string[] = [
  'ai.provider.default',
  'tasks',
  'providers.ollama.baseUrl',
  ...aiProviderIds.map((id) => `providers.${id}.model`),
  ...storyboardSettingCatalog.map((entry) => entry.key),
];

function resolveConfiguredModel(configured: string | undefined, fallbackId: string): string {
  const trimmed: string | undefined = configured?.trim();

  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }

  return fallbackId;
}
