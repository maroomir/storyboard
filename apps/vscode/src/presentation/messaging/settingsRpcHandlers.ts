import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardResponsePayload,
  AiTaskName,
  AiProviderStatus,
  AiProviderId,
  ProviderModelOptions,
  ConfigValueOrigin,
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

export interface SettingsConfigFiles {
  readonly user: string;
  readonly workspace?: string;
}

export interface SettingsRpcHandlersDependencies {
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly registry: AiProviderRegistry;
  readonly configFiles: () => SettingsConfigFiles;
}

type SettingsReadDependencies = Pick<
  SettingsRpcHandlersDependencies,
  'configBridge' | 'registry' | 'configFiles'
>;

export async function getSettingsReadSnapshot(
  deps: SettingsReadDependencies,
): Promise<StoryboardResponsePayload<'settings.read'>> {
  return buildSettingsReadSnapshot(deps);
}

export function createSettingsRpcHandlers(
  deps: SettingsRpcHandlersDependencies,
): StoryboardRpcHandlers {
  const { configBridge, secretStore } = deps;
  const savedTo = (key: string): StoryboardResponsePayload<'settings.updateDefaultProvider'> =>
    describeSaveTarget(deps, key);

  return {
    'settings.read': async (): Promise<StoryboardResponsePayload<'settings.read'>> =>
      buildSettingsReadSnapshot(deps),

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

function describeSaveTarget(
  deps: SettingsReadDependencies,
  key: string,
): StoryboardResponsePayload<'settings.updateDefaultProvider'> {
  const origin: ConfigValueOrigin = deps.configBridge.getValueOrigin(key);
  const files: SettingsConfigFiles = deps.configFiles();
  const file: string | undefined = origin === 'workspace' ? files.workspace : files.user;

  return { origin, ...(file === undefined ? {} : { file }) };
}

const originTrackedKeys: string[] = [
  'ai.provider.default',
  'tasks',
  'providers.ollama.baseUrl',
  ...aiProviderIds.map((id) => `providers.${id}.model`),
  ...storyboardSettingCatalog.map((entry) => entry.key),
];

async function buildSettingsReadSnapshot(
  deps: SettingsReadDependencies,
): Promise<StoryboardResponsePayload<'settings.read'>> {
  const { configBridge, registry } = deps;
  const providers: AiProviderStatus[] = await registry.listProviders();
  const defaultProvider: AiProviderId = configBridge.getDefaultProvider();

  const providerConfigs: StoryboardResponsePayload<'settings.read'>['providerConfigs'] =
    buildProviderConfigsPayload(configBridge);
  const taskAssignments: StoryboardResponsePayload<'settings.read'>['taskAssignments'] =
    buildTaskAssignmentsPayload(configBridge);

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
    configFiles: deps.configFiles(),
    settingCatalog: storyboardSettingCatalog.map((entry) => ({ ...entry })),
    settingValues: Object.fromEntries(
      storyboardSettingCatalog.map((entry) => [entry.key, configBridge.getSettingValue(entry.key)]),
    ),
  };
}

function buildProviderConfigsPayload(
  configBridge: ConfigBridge,
): StoryboardResponsePayload<'settings.read'>['providerConfigs'] {
  const providerConfigs: StoryboardResponsePayload<'settings.read'>['providerConfigs'] =
    {} as StoryboardResponsePayload<'settings.read'>['providerConfigs'];

  for (const id of aiProviderIds) {
    const runtime: ProviderModelConfig = configBridge.getProviderConfig(id);
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

function resolveConfiguredModel(configured: string | undefined, fallbackId: string): string {
  const trimmed: string | undefined = configured?.trim();

  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }

  return fallbackId;
}

function buildTaskAssignmentsPayload(
  configBridge: ConfigBridge,
): StoryboardResponsePayload<'settings.read'>['taskAssignments'] {
  return Object.fromEntries(
    aiTaskNames.map((taskName: AiTaskName) => {
      const override: TaskAiConfigOverride | null = configBridge.getTaskAiConfigOverride(taskName);
      const entry: StoryboardResponsePayload<'settings.read'>['taskAssignments'][AiTaskName] =
        override === null
          ? { providerId: null, model: null }
          : { providerId: override.providerId, model: override.model };

      return [taskName, entry];
    }),
  ) as StoryboardResponsePayload<'settings.read'>['taskAssignments'];
}
