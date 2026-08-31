import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardResponsePayload } from '@storyboard/story-engine';
import {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskNames,
  isCliProvider,
  storyboardModelCatalog,
} from '@storyboard/story-ai';
import type {
  AiProviderRegistry,
  AiTaskName,
  ConfigBridge,
  SecretStore,
} from '@storyboard/story-ai';
export interface SettingsRpcHandlersDependencies {
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly registry: AiProviderRegistry;
}

export async function getSettingsReadSnapshot(
  deps: Pick<SettingsRpcHandlersDependencies, 'configBridge' | 'registry'>,
): Promise<StoryboardResponsePayload<'settings.read'>> {
  return buildSettingsReadSnapshot(deps.configBridge, deps.registry);
}

export function createSettingsRpcHandlers(
  deps: SettingsRpcHandlersDependencies,
): StoryboardRpcHandlers {
  const { configBridge, secretStore, registry } = deps;

  return {
    'settings.read': async (): Promise<StoryboardResponsePayload<'settings.read'>> =>
      buildSettingsReadSnapshot(configBridge, registry),

    'settings.updateDefaultProvider': async (
      payload,
    ): Promise<StoryboardResponsePayload<'settings.updateDefaultProvider'>> => {
      await configBridge.setDefaultProvider(payload.providerId);
      return {};
    },

    'settings.updateProviderModel': async (
      payload,
    ): Promise<StoryboardResponsePayload<'settings.updateProviderModel'>> => {
      await configBridge.setProviderModel(payload.providerId, payload.model);
      return {};
    },

    'settings.updateProviderBaseUrl': async (
      payload,
    ): Promise<StoryboardResponsePayload<'settings.updateProviderBaseUrl'>> => {
      await configBridge.setProviderBaseUrl(payload.baseUrl);
      return {};
    },

    'settings.updateProviderCommand': async (
      payload,
    ): Promise<StoryboardResponsePayload<'settings.updateProviderCommand'>> => {
      await configBridge.setProviderCommand(payload.providerId, payload.command);
      return {};
    },

    'settings.updateTaskAiConfig': async (
      payload,
    ): Promise<StoryboardResponsePayload<'settings.updateTaskAiConfig'>> => {
      await configBridge.setTaskAiConfig(payload.taskName, {
        providerId: payload.providerId,
        model: payload.model,
      });
      return {};
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

async function buildSettingsReadSnapshot(
  configBridge: ConfigBridge,
  registry: AiProviderRegistry,
): Promise<StoryboardResponsePayload<'settings.read'>> {
  const providers = await registry.listProviders();
  const defaultProvider = configBridge.getDefaultProvider();

  const providerConfigs = buildProviderConfigsPayload(configBridge);
  const taskAssignments = buildTaskAssignmentsPayload(configBridge);

  const modelCatalog = Object.fromEntries(
    aiProviderIds.map((id) => [id, [...storyboardModelCatalog[id]]]),
  ) as StoryboardResponsePayload<'settings.read'>['modelCatalog'];

  return {
    defaultProvider,
    providers,
    providerConfigs,
    taskAssignments,
    modelCatalog,
    taskCatalog: aiTaskCatalog.map((task) => ({
      name: task.name,
      label: task.label,
      status: task.status,
    })),
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
    } else if (isCliProvider(id)) {
      const command = runtime.command?.trim();
      result[id] = command !== undefined && command.length > 0 ? { model, command } : { model };
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
