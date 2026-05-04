import { describe, expect, it } from "vitest"

import { createWebviewBridge, type StoryboardWebviewLike } from "../../../../src/messaging/bridge"
import {
  parseStoryboardRequestMessage,
  settingsUpdateProviderModelRequestPayloadSchema,
  storyboardMessageProtocolVersion
} from "../../../../src/shared/messaging"
import { storyboardModelCatalog } from "../../../../src/shared/models"
import { createAiProviderRegistry, type AiProviderRegistry } from "../../../../src/services/ai/providerRegistry"
import { type ClaudeClientLike } from "../../../../src/services/ai/providers/ClaudeProvider"
import { type GoogleClientLike } from "../../../../src/services/ai/providers/GoogleProvider"
import { type OllamaClientLike } from "../../../../src/services/ai/providers/OllamaProvider"
import { type OpenAiClientLike } from "../../../../src/services/ai/providers/OpenAiProvider"
import { SecretStore, type StoryboardSecretStorageLike } from "../../../../src/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "../../../../src/services/settings/ConfigBridge"
import { createSettingsRpcHandlers } from "../../../../src/services/settings/settingsRpcHandlers"
import { aiTaskNames } from "../../../../src/services/ai/types"

class MutableFakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: Map<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    if (this.values.has(section)) {
      return this.values.get(section) as T
    }

    const taskProviderMatch = /^tasks\.([^.]+)\.provider$/.exec(section)

    if (taskProviderMatch) {
      const tasks = this.values.get("tasks") as Record<string, { provider?: string }> | undefined
      const provider = tasks?.[taskProviderMatch[1] ?? ""]?.provider

      if (provider !== undefined) {
        return provider as T
      }
    }

    return defaultValue
  }

  public async update<T>(section: string, value: T): Promise<void> {
    if (section === "tasks") {
      for (const key of [...this.values.keys()]) {
        if (key.startsWith("tasks.")) {
          this.values.delete(key)
        }
      }
    }

    this.values.set(section, value as unknown)
  }
}

class FakeSecretStorage implements StoryboardSecretStorageLike {
  public constructor(private readonly values: Map<string, string>) {}

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key)
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

function createFakeOpenAiClient(): OpenAiClientLike {
  return {
    models: { list: async (): Promise<unknown> => ({}) },
    chat: {
      completions: {
        create: async (): Promise<{ readonly choices: readonly [{ readonly message: { readonly content: string } }] }> => ({
          choices: [{ message: { content: "ok" } }]
        })
      }
    }
  }
}

function createFakeClaudeClient(): ClaudeClientLike {
  return {
    messages: {
      create: async (): Promise<{ readonly content: readonly [{ readonly type: "text"; readonly text: string }] }> => ({
        content: [{ type: "text", text: "ok" }]
      })
    }
  }
}

function createFakeGoogleClient(): GoogleClientLike {
  return {
    getGenerativeModel: () => ({
      generateContent: async (): Promise<{ readonly response: { readonly text: () => string } }> => ({
        response: { text: (): string => "ok" }
      })
    })
  }
}

function createFakeOllamaClient(): OllamaClientLike {
  return {
    get: async (): Promise<unknown> => ({}),
    post: async (): Promise<{ readonly message: { readonly content: string } }> => ({
      message: { content: "ok" }
    })
  }
}

function createTestRegistry(configuration: Map<string, unknown>, secretValues: Map<string, string>): AiProviderRegistry {
  const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
  })

  return createAiProviderRegistry({
    secretStore,
    configBridge,
    createClaudeClient: (): ClaudeClientLike => createFakeClaudeClient(),
    createGoogleClient: (): GoogleClientLike => createFakeGoogleClient(),
    createOllamaClient: (): OllamaClientLike => createFakeOllamaClient(),
    createOpenAiClient: (): OpenAiClientLike => createFakeOpenAiClient()
  })
}

describe("createSettingsRpcHandlers", () => {
  it("implements settings.read with catalog, provider list, and task assignments", async () => {
    const configuration = new Map<string, unknown>([
      ["defaultProvider", "mock"],
      ["tasks", { sceneDraft: { provider: "claude" } }]
    ])
    const secretValues = new Map<string, string>([
      ["storyboard.apiKey.openai", "sk-test"],
      ["storyboard.apiKey.claude", "sk-ant-test"],
      ["storyboard.apiKey.google", "google-test"]
    ])
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry })

    const snapshot = await handlers["settings.read"]!({}, {} as never)

    expect(snapshot.defaultProvider).toBe("mock")
    expect(snapshot.providers).toHaveLength(5)
    expect(snapshot.taskAssignments.sceneDraft).toBe("claude")
    for (const taskName of aiTaskNames) {
      expect(snapshot.taskAssignments).toHaveProperty(taskName)
    }
    for (const id of ["openai", "claude", "google", "ollama", "mock"] as const) {
      expect(snapshot.modelCatalog[id].map((o) => o.id)).toEqual(storyboardModelCatalog[id].map((o) => o.id))
    }
  })

  it("updates default provider, model, base URL, and task provider via RPC", async () => {
    const configuration = new Map<string, unknown>([["defaultProvider", "mock"]])
    const secretValues = new Map<string, string>([
      ["storyboard.apiKey.openai", "sk-test"],
      ["storyboard.apiKey.claude", "sk-ant-test"],
      ["storyboard.apiKey.google", "google-test"]
    ])
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry })

    await handlers["settings.updateDefaultProvider"]!({ providerId: "openai" }, {} as never)
    expect(configuration.get("defaultProvider")).toBe("openai")

    await handlers["settings.updateProviderModel"]!({ providerId: "google", model: "gemini-2.5-pro" }, {} as never)
    expect(configuration.get("providers.google.model")).toBe("gemini-2.5-pro")

    await handlers["settings.updateProviderBaseUrl"]!({ providerId: "ollama", baseUrl: "http://ollama.local:11434" }, {} as never)
    expect(configuration.get("providers.ollama.baseUrl")).toBe("http://ollama.local:11434")

    await handlers["settings.updateTaskProvider"]!({ taskName: "grammarCheck", providerId: "google" }, {} as never)
    const tasks = configuration.get("tasks") as Record<string, { provider: string }>
    expect(tasks["grammarCheck"]?.provider).toBe("google")

    await handlers["settings.updateTaskProvider"]!({ taskName: "grammarCheck", providerId: null }, {} as never)
    const tasksAfterClear = configuration.get("tasks") as Record<string, { provider: string }>
    expect(tasksAfterClear["grammarCheck"]).toBeUndefined()
  })

  it("writes and deletes API keys via secrets RPC", async () => {
    const configuration = new Map<string, unknown>()
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry })

    const writeResult = await handlers["secrets.writeApiKey"]!({ providerId: "openai", apiKey: "new-secret" }, {} as never)
    expect(writeResult).toEqual({ hasApiKey: true })
    expect(await secretStore.hasApiKey("openai")).toBe(true)

    const deleteResult = await handlers["secrets.deleteApiKey"]!({ providerId: "openai" }, {} as never)
    expect(deleteResult).toEqual({ hasApiKey: false })
    expect(await secretStore.hasApiKey("openai")).toBe(false)
  })

  it("rejects settings.updateProviderModel payloads outside the catalog (zod)", () => {
    expect(() =>
      settingsUpdateProviderModelRequestPayloadSchema.parse({
        providerId: "openai",
        model: "not-in-catalog"
      })
    ).toThrow(/catalog option/)

    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "req-model",
        method: "settings.updateProviderModel",
        payload: { providerId: "claude", model: "claude-2" }
      })
    ).toThrow()
  })
})

class FakeWebview implements StoryboardWebviewLike {
  public readonly postedMessages: unknown[] = []
  private listener: ((message: unknown) => void | PromiseLike<void>) | undefined

  public async postMessage(message: unknown): Promise<boolean> {
    this.postedMessages.push(message)
    return true
  }

  public onDidReceiveMessage(
    listener: (message: unknown) => void | PromiseLike<void>
  ): { readonly dispose: () => void } {
    this.listener = listener
    return { dispose: (): void => undefined }
  }

  public async receive(message: unknown): Promise<void> {
    await this.listener?.(message)
  }
}

describe("settings RPC via webview bridge", () => {
  it("returns validation-error for invalid settings.updateProviderModel", async () => {
    const configuration = new Map<string, unknown>()
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const webview = new FakeWebview()

    createWebviewBridge(webview, createSettingsRpcHandlers({ configBridge, secretStore, registry }))

    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "bad-model",
      method: "settings.updateProviderModel",
      payload: { providerId: "openai", model: "gpt-99-fake" }
    })

    expect(webview.postedMessages).toHaveLength(1)
    expect(webview.postedMessages[0]).toMatchObject({
      id: "unknown",
      method: "unknown",
      ok: false,
      error: { code: "validation-error" }
    })
  })
})
