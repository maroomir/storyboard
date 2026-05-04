import type { StoryboardRpcHandlers } from "../../messaging/bridge"
import type { StoryboardResponsePayload } from "../../shared/messaging"
import { storyboardModelCatalog } from "../../shared/models"
import { aiProviderIds, aiTaskNames, type AiProviderId, type AiTaskName } from "../ai/types"
import type { AiProviderRegistry } from "../ai/providerRegistry"
import type { SecretStore } from "../secrets/SecretStore"
import type { ConfigBridge } from "./ConfigBridge"

export interface SettingsRpcHandlersDependencies {
  readonly configBridge: ConfigBridge
  readonly secretStore: SecretStore
  readonly registry: AiProviderRegistry
}

export function createSettingsRpcHandlers(deps: SettingsRpcHandlersDependencies): StoryboardRpcHandlers {
  const { configBridge, secretStore, registry } = deps

  return {
    "settings.read": async (): Promise<StoryboardResponsePayload<"settings.read">> =>
      buildSettingsReadSnapshot(configBridge, registry),

    "settings.updateDefaultProvider": async (
      payload
    ): Promise<StoryboardResponsePayload<"settings.updateDefaultProvider">> => {
      await configBridge.setDefaultProvider(payload.providerId)
      return {}
    },

    "settings.updateProviderModel": async (
      payload
    ): Promise<StoryboardResponsePayload<"settings.updateProviderModel">> => {
      await configBridge.setProviderModel(payload.providerId, payload.model)
      return {}
    },

    "settings.updateProviderBaseUrl": async (
      payload
    ): Promise<StoryboardResponsePayload<"settings.updateProviderBaseUrl">> => {
      await configBridge.setProviderBaseUrl(payload.baseUrl)
      return {}
    },

    "settings.updateTaskProvider": async (
      payload
    ): Promise<StoryboardResponsePayload<"settings.updateTaskProvider">> => {
      await configBridge.setTaskProvider(payload.taskName, payload.providerId)
      return {}
    },

    "secrets.writeApiKey": async (payload): Promise<StoryboardResponsePayload<"secrets.writeApiKey">> => {
      await secretStore.setApiKey(payload.providerId, payload.apiKey)
      return { hasApiKey: true }
    },

    "secrets.deleteApiKey": async (payload): Promise<StoryboardResponsePayload<"secrets.deleteApiKey">> => {
      await secretStore.deleteApiKey(payload.providerId)
      return { hasApiKey: false }
    }
  }
}

async function buildSettingsReadSnapshot(
  configBridge: ConfigBridge,
  registry: AiProviderRegistry
): Promise<StoryboardResponsePayload<"settings.read">> {
  const providers = await registry.listProviders()
  const defaultProvider = configBridge.getDefaultProvider()

  const providerConfigs = buildProviderConfigsPayload(configBridge)
  const taskAssignments = buildTaskAssignmentsPayload(configBridge)

  const modelCatalog = Object.fromEntries(
    aiProviderIds.map((id) => [id, [...storyboardModelCatalog[id]]])
  ) as StoryboardResponsePayload<"settings.read">["modelCatalog"]

  return {
    defaultProvider,
    providers,
    providerConfigs,
    taskAssignments,
    modelCatalog
  }
}

function buildProviderConfigsPayload(
  configBridge: ConfigBridge
): StoryboardResponsePayload<"settings.read">["providerConfigs"] {
  const result = {} as StoryboardResponsePayload<"settings.read">["providerConfigs"]

  for (const id of aiProviderIds) {
    const runtime = configBridge.getProviderConfig(id)
    const catalog = storyboardModelCatalog[id]
    const model = resolveConfiguredModel(runtime.model, catalog[0].id)

    if (id === "ollama") {
      const baseUrl = runtime.baseUrl?.trim()
      result[id] =
        baseUrl !== undefined && baseUrl.length > 0 ? { model, baseUrl } : { model }
    } else {
      result[id] = { model }
    }
  }

  return result
}

function resolveConfiguredModel(configured: string | undefined, fallbackId: string): string {
  const trimmed = configured?.trim()

  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed
  }

  return fallbackId
}

function buildTaskAssignmentsPayload(
  configBridge: ConfigBridge
): StoryboardResponsePayload<"settings.read">["taskAssignments"] {
  return Object.fromEntries(
    aiTaskNames.map((taskName: AiTaskName) => [taskName, configBridge.getTaskProviderOverride(taskName)])
  ) as Record<AiTaskName, AiProviderId | null>
}
