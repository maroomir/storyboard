import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardResponsePayload } from '@storyboard/story-engine';
import {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskNames,
  storyboardModelCatalog,
  storyboardSettingCatalog,
} from '@storyboard/story-model';
import type { AiProviderRegistry, ConfigBridge, SecretStore } from '@storyboard/story-ai';
import type { AiTaskName } from '@storyboard/story-model';

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

// A write goes to the workspace file only when that layer already held the key (ConfigBridge
// picks the target), so the origin read back after the write is where the value now lives.
function describeSaveTarget(
  deps: SettingsReadDependencies,
  key: string,
): StoryboardResponsePayload<'settings.updateDefaultProvider'> {
  const origin = deps.configBridge.getValueOrigin(key);
  const files = deps.configFiles();
  const file = origin === 'workspace' ? files.workspace : files.user;

  return { origin, ...(file === undefined ? {} : { file }) };
}

const originTrackedKeys = [
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
  const providers = await registry.listProviders();
  const defaultProvider = configBridge.getDefaultProvider();

  const providerConfigs = buildProviderConfigsPayload(configBridge);
  const taskAssignments = buildTaskAssignmentsPayload(configBridge);

  const modelCatalog = Object.fromEntries(
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
  const result = {} as StoryboardResponsePayload<'settings.read'>['providerConfigs'];

  for (const id of aiProviderIds) {
    const runtime = configBridge.getProviderConfig(id);
    const catalog = storyboardModelCatalog[id];
    const model = resolveConfiguredModel(runtime.model, catalog[0].id);

    if (id === 'ollama') {
      const baseUrl = runtime.baseUrl?.trim();
      result[id] = baseUrl !== undefined && baseUrl.length > 0 ? { model, baseUrl } : { model };
    } else {
      result[id] = { model };
    }
  }

  return result;
}

function resolveConfiguredModel(configured: string | undefined, fallbackId: string): string {
  const trimmed = configured?.trim();

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
      const override = configBridge.getTaskAiConfigOverride(taskName);
      const entry =
        override === null
          ? { providerId: null, model: null }
          : { providerId: override.providerId, model: override.model };

      return [taskName, entry];
    }),
  ) as StoryboardResponsePayload<'settings.read'>['taskAssignments'];
}
