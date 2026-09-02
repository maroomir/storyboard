import { describe, expect, it } from "vitest"

import { createWebviewBridge, type StoryboardWebviewLike } from "@/presentation/messaging/bridge"
import {
  parseStoryboardRequestMessage,
  settingsUpdateProviderModelRequestPayloadSchema,
  settingsUpdateSettingValueRequestPayloadSchema,
  settingsUpdateTaskAiConfigRequestPayloadSchema,
  storyboardMessageProtocolVersion
} from "@storyboard/story-engine"
import { aiProviderIds, aiTaskNames, ConfigBridge, createAiProviderRegistry, SecretStore, storyboardModelCatalog } from '@storyboard/story-ai';
import type { AiProviderRegistry, ClaudeClientLike, GoogleClientLike, OllamaClientLike, OpenAiClientLike, StoryboardConfigurationLike, StoryboardSecretStorageLike } from '@storyboard/story-ai';
import { createSettingsRpcHandlers } from "@/presentation/messaging/settingsRpcHandlers"

const configFiles = (): { user: string; workspace?: string } => ({
  user: "/home/me/.storyboard/config.json",
  workspace: "/work/novel/.storyboard/config.json"
})
class MutableFakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: Map<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    if (this.values.has(section)) {
      return this.values.get(section) as T
    }

    const taskProviderMatch = /^tasks\.([^.]+)\.provider$/.exec(section)

    if (taskProviderMatch) {
      const tasks = this.values.get("tasks") as Record<string, { provider?: string; model?: string }> | undefined
      const provider = tasks?.[taskProviderMatch[1] ?? ""]?.provider

      if (provider !== undefined) {
        return provider as T
      }
    }

    const taskModelMatch = /^tasks\.([^.]+)\.model$/.exec(section)

    if (taskModelMatch) {
      const tasks = this.values.get("tasks") as Record<string, { provider?: string; model?: string }> | undefined
      const model = tasks?.[taskModelMatch[1] ?? ""]?.model

      if (model !== undefined) {
        return model as T
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
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    const snapshot = await handlers["settings.read"]!({}, {} as never)

    expect(snapshot.defaultProvider).toBe("mock")
    expect(snapshot.providers).toHaveLength(aiProviderIds.length)
    expect(snapshot.taskAssignments.sceneDraft).toEqual({ providerId: "claude", model: null })
    for (const taskName of aiTaskNames) {
      expect(snapshot.taskAssignments).toHaveProperty(taskName)
    }
    for (const id of aiProviderIds) {
      expect(snapshot.modelCatalog[id].map((o) => o.id)).toEqual(storyboardModelCatalog[id].map((o) => o.id))
    }

    expect(snapshot.providerConfigs["claude-code"].command).toBe("claude")
    expect(snapshot.providerConfigs["codex"].command).toBe("codex")
    expect(snapshot.providerConfigs["openai"].command).toBeUndefined()
  })

  it("ships the configured CLI command in settings.read and writes it via updateProviderCommand", async () => {
    const configuration = new Map<string, unknown>([["providers.claude-code.command", "/custom/claude"]])
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    const snapshot = await handlers["settings.read"]!({}, {} as never)
    expect(snapshot.providerConfigs["claude-code"].command).toBe("/custom/claude")

    await handlers["settings.updateProviderCommand"]!({ providerId: "codex", command: "/opt/codex" }, {} as never)
    expect(configuration.get("providers.codex.command")).toBe("/opt/codex")
  })

  it("settings.read returns stored task model alongside provider when both are set", async () => {
    const configuration = new Map<string, unknown>([
      ["defaultProvider", "mock"],
      ["tasks", { sceneDraft: { provider: "claude", model: "claude-haiku-4-5" } }]
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
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    const snapshot = await handlers["settings.read"]!({}, {} as never)

    expect(snapshot.taskAssignments.sceneDraft).toEqual({
      providerId: "claude",
      model: "claude-haiku-4-5"
    })
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
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    await handlers["settings.updateDefaultProvider"]!({ providerId: "openai" }, {} as never)
    expect(configuration.get("defaultProvider")).toBe("openai")

    await handlers["settings.updateProviderModel"]!({ providerId: "google", model: "gemini-2.5-pro" }, {} as never)
    expect(configuration.get("providers.google.model")).toBe("gemini-2.5-pro")

    await handlers["settings.updateProviderBaseUrl"]!({ providerId: "ollama", baseUrl: "http://ollama.local:11434" }, {} as never)
    expect(configuration.get("providers.ollama.baseUrl")).toBe("http://ollama.local:11434")

    await handlers["settings.updateTaskAiConfig"]!(
      { taskName: "grammarCheck", providerId: "google", model: "gemini-2.5-flash" },
      {} as never
    )
    const tasks = configuration.get("tasks") as Record<string, { provider: string; model?: string }>
    expect(tasks["grammarCheck"]?.provider).toBe("google")
    expect(tasks["grammarCheck"]?.model).toBe("gemini-2.5-flash")

    await handlers["settings.updateTaskAiConfig"]!(
      { taskName: "grammarCheck", providerId: null, model: null },
      {} as never
    )
    const tasksAfterClear = configuration.get("tasks") as Record<string, { provider: string }>
    expect(tasksAfterClear["grammarCheck"]).toBeUndefined()
  })

  it("reports where each value came from and where a write landed", async () => {
    const configuration = new Map<string, unknown>([["defaultProvider", "codex"], ["draft.keepHistory", true]])
    const registry = createTestRegistry(configuration, new Map())
    const secretStore = new SecretStore(new FakeSecretStorage(new Map()))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => ({
        get: <T>(section: string, defaultValue: T): T =>
          (configuration.has(section) ? configuration.get(section) : defaultValue) as T,
        inspect: <T>(section: string): { globalValue?: T; workspaceValue?: T } =>
          section === "draft.keepHistory"
            ? { workspaceValue: configuration.get(section) as T }
            : { globalValue: configuration.get(section) as T | undefined },
        update: async (section, value): Promise<void> => {
          configuration.set(section, value)
        }
      })
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    const snapshot = await handlers["settings.read"]!({}, {} as never)

    expect(snapshot.origins["defaultProvider"]).toBe("user")
    expect(snapshot.origins["draft.keepHistory"]).toBe("workspace")
    expect(snapshot.origins["draft.reviseMaxIterations"]).toBe("default")
    expect(snapshot.configFiles).toEqual(configFiles())
    expect(snapshot.settingValues["draft.keepHistory"]).toBe(true)
    expect(snapshot.settingValues["draft.reviseMaxIterations"]).toBe(2)
    expect(snapshot.settingCatalog.map((entry) => entry.key)).toContain("studio.validation")

    const saved = await handlers["settings.updateSettingValue"]!({ key: "draft.keepHistory", value: false }, {} as never)
    expect(saved).toEqual({ origin: "workspace", file: "/work/novel/.storyboard/config.json" })
    expect(configuration.get("draft.keepHistory")).toBe(false)

    const savedDefault = await handlers["settings.updateDefaultProvider"]!({ providerId: "mock" }, {} as never)
    expect(savedDefault).toEqual({ origin: "user", file: "/home/me/.storyboard/config.json" })
  })

  it("rejects settings.updateSettingValue outside the catalog or its bounds (zod)", () => {
    expect(settingsUpdateSettingValueRequestPayloadSchema.safeParse({ key: "nope", value: true }).success).toBe(false)
    expect(
      settingsUpdateSettingValueRequestPayloadSchema.safeParse({ key: "draft.reviseMaxIterations", value: 9 }).success
    ).toBe(false)
    expect(
      settingsUpdateSettingValueRequestPayloadSchema.safeParse({ key: "draft.reviseMaxIterations", value: 3 }).success
    ).toBe(true)
    expect(settingsUpdateSettingValueRequestPayloadSchema.safeParse({ key: "draft.keepHistory", value: "yes" }).success).toBe(false)
  })

  it("writes and deletes API keys via secrets RPC", async () => {
    const configuration = new Map<string, unknown>()
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const handlers = createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles })

    const writeResult = await handlers["secrets.writeApiKey"]!({ providerId: "openai", apiKey: "new-secret" }, {} as never)
    expect(writeResult).toEqual({ hasApiKey: true })
    expect(await secretStore.hasApiKey("openai")).toBe(true)

    const deleteResult = await handlers["secrets.deleteApiKey"]!({ providerId: "openai" }, {} as never)
    expect(deleteResult).toEqual({ hasApiKey: false })
    expect(await secretStore.hasApiKey("openai")).toBe(false)
  })

  it("rejects settings.updateTaskAiConfig when provider and model rules are broken (zod)", () => {
    expect(() =>
      settingsUpdateTaskAiConfigRequestPayloadSchema.parse({
        taskName: "sceneDraft",
        providerId: null,
        model: "gpt-5-mini"
      })
    ).toThrow(/model must be null/)

    expect(() =>
      settingsUpdateTaskAiConfigRequestPayloadSchema.parse({
        taskName: "sceneDraft",
        providerId: "openai",
        model: null
      })
    ).toThrow(/model is required/)

    expect(() =>
      settingsUpdateTaskAiConfigRequestPayloadSchema.parse({
        taskName: "sceneDraft",
        providerId: "openai",
        model: "not-in-catalog"
      })
    ).toThrow(/catalog option/)

    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "req-task-ai",
        method: "settings.updateTaskAiConfig",
        payload: { taskName: "sceneDraft", providerId: "claude", model: "claude-2-legacy" }
      })
    ).toThrow()
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

    createWebviewBridge(webview, createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles }))

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

  it("returns validation-error for settings.updateProviderCommand on a non-CLI provider", async () => {
    const configuration = new Map<string, unknown>()
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const webview = new FakeWebview()

    createWebviewBridge(webview, createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles }))

    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "bad-command",
      method: "settings.updateProviderCommand",
      payload: { providerId: "openai", command: "claude" }
    })

    expect(webview.postedMessages).toHaveLength(1)
    expect(webview.postedMessages[0]).toMatchObject({
      id: "unknown",
      method: "unknown",
      ok: false,
      error: { code: "validation-error" }
    })
  })

  it("returns validation-error for invalid settings.updateTaskAiConfig via webview bridge", async () => {
    const configuration = new Map<string, unknown>()
    const secretValues = new Map<string, string>()
    const registry = createTestRegistry(configuration, secretValues)
    const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new MutableFakeConfiguration(configuration)
    })
    const webview = new FakeWebview()

    createWebviewBridge(webview, createSettingsRpcHandlers({ configBridge, secretStore, registry, configFiles }))

    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "bad-task-ai",
      method: "settings.updateTaskAiConfig",
      payload: { taskName: "sceneDraft", providerId: "openai", model: "gpt-99-fake" }
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
