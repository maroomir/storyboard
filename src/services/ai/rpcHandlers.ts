import { resolveStoryboardWorkspaceRoot } from "@/core/workspace"
import { emptyUsageSummary } from "@/files/usageLedger"
import { type StoryboardRpcHandlers } from "@/messaging/bridge"
import { type StoryboardResponsePayload } from "@/shared/messaging"
import { AiProviderRegistry } from "./providerRegistry"
import type { UsageRecorder } from "./UsageRecorder"

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

export function createUsageRpcHandlers(recorder: UsageRecorder): Pick<StoryboardRpcHandlers, "usage.read"> {
  return {
    "usage.read": async (): Promise<StoryboardResponsePayload<"usage.read">> => {
      const root = await resolveStoryboardWorkspaceRoot()

      if (!root) {
        return emptyUsageSummary()
      }

      return recorder.getSummary(root)
    }
  }
}
