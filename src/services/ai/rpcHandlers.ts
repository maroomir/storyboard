import { type StoryboardRpcHandlers } from "../../messaging/bridge"
import { type StoryboardResponsePayload } from "../../shared/messaging"
import { AiProviderRegistry } from "./providerRegistry"

export function createAiRpcHandlers(registry: AiProviderRegistry): StoryboardRpcHandlers {
  return {
    "ai.providers.list": async (): Promise<StoryboardResponsePayload<"ai.providers.list">> => ({
      providers: await registry.listProviders()
    }),
    "ai.providers.checkConnection": async (
      payload
    ): Promise<StoryboardResponsePayload<"ai.providers.checkConnection">> => ({
      ok: await registry.checkConnection(payload.providerId)
    }),
    "ai.generate": async (payload): Promise<StoryboardResponsePayload<"ai.generate">> =>
      registry.generateWithProvider(payload.providerId, {
        taskName: payload.taskName,
        messages: payload.messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      })
  }
}
