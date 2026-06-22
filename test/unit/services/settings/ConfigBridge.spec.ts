import { describe, expect, it } from "vitest"

import {
  ConfigBridge,
  type StoryboardConfigurationChangeEventLike,
  type StoryboardConfigurationLike
} from "@/services/settings/ConfigBridge"

class FakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: ReadonlyMap<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    return (this.values.has(section) ? this.values.get(section) : defaultValue) as T
  }
}

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

describe("ConfigBridge", () => {
  it("uses mock as the default provider when configuration is missing", () => {
    const configBridge = createConfigBridge(new Map())

    expect(configBridge.getDefaultProvider()).toBe("mock")
    expect(configBridge.getTaskProvider("sceneDraft")).toBe("mock")
  })

  it("uses task provider override before the default provider", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "openai"],
        ["tasks.sceneDraft.provider", "claude"]
      ])
    )

    expect(configBridge.getTaskProvider("sceneDraft")).toBe("claude")
    expect(configBridge.getTaskProvider("grammarCheck")).toBe("openai")
    expect(configBridge.getTaskAiConfigOverride("sceneDraft")).toEqual({ providerId: "claude", model: null })
  })

  it("reads legacy flat tasks.<task>.provider without a merged tasks object", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "openai"],
        ["providers.claude.model", "claude-sonnet-4-6"],
        ["tasks.sceneDraft.provider", "claude"]
      ])
    )

    expect(configBridge.getTaskAiConfigOverride("sceneDraft")).toEqual({ providerId: "claude", model: null })
    expect(configBridge.getTaskAiConfig("sceneDraft")).toEqual({
      providerId: "claude",
      model: "claude-sonnet-4-6"
    })
  })

  it("uses per-task model override when stored and falls back to provider global for provider-only tasks", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "openai"],
        ["providers.claude.model", "claude-sonnet-4-6"],
        ["tasks", { sceneDraft: { provider: "claude", model: "claude-haiku-4-5" } }]
      ])
    )

    expect(configBridge.getTaskAiConfig("sceneDraft")).toEqual({
      providerId: "claude",
      model: "claude-haiku-4-5"
    })

    const providerOnly = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "openai"],
        ["providers.claude.model", "claude-sonnet-4-6"],
        ["tasks", { sceneDraft: { provider: "claude" } }]
      ])
    )

    expect(providerOnly.getTaskAiConfigOverride("sceneDraft")).toEqual({ providerId: "claude", model: null })
    expect(providerOnly.getTaskAiConfig("sceneDraft")).toEqual({ providerId: "claude", model: "claude-sonnet-4-6" })
  })

  it("falls back to mock for invalid provider values", () => {
    const configBridge = createConfigBridge(new Map<string, unknown>([["defaultProvider", "unknown"]]))

    expect(configBridge.getDefaultProvider()).toBe("mock")
  })

  it("reads provider model and ollama base URL settings", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["providers.openai.model", "gpt-4.1"],
        ["providers.ollama.baseUrl", "http://localhost:11435"],
        ["providers.ollama.model", "mistral"]
      ])
    )

    expect(configBridge.getProviderConfig("openai")).toEqual({ model: "gpt-4.1" })
    expect(configBridge.getProviderConfig("ollama")).toEqual({
      baseUrl: "http://localhost:11435",
      model: "mistral"
    })
  })

  it("notifies when Storyboard configuration changes", () => {
    let listener: ((event: StoryboardConfigurationChangeEventLike) => void) | undefined
    let changeCount = 0
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(new Map()),
      onDidChangeConfiguration: (
        nextListener
      ): { readonly dispose: () => void } => {
        listener = nextListener
        return { dispose: (): void => undefined }
      }
    })

    configBridge.onDidChange(() => {
      changeCount += 1
    })
    listener?.({ affectsConfiguration: (section): boolean => section === "storyboard" })
    listener?.({ affectsConfiguration: (): boolean => false })

    expect(changeCount).toBe(1)
  })

  it("writes default provider and merges task overrides into the tasks object", async () => {
    const values = new Map<string, unknown>([
      ["defaultProvider", "mock"],
      ["tasks", { sceneDraft: { provider: "claude" } }]
    ])
    const configuration = new MutableFakeConfiguration(values)
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => configuration
    })

    await configBridge.setDefaultProvider("openai")
    expect(values.get("defaultProvider")).toBe("openai")

    await configBridge.setTaskAiConfig("grammarCheck", { providerId: "google", model: "gemini-2.5-flash" })
    const tasksAfterAdd = values.get("tasks") as Record<string, { provider: string; model?: string }>
    expect(tasksAfterAdd["sceneDraft"]?.provider).toBe("claude")
    expect(tasksAfterAdd["grammarCheck"]?.provider).toBe("google")
    expect(tasksAfterAdd["grammarCheck"]?.model).toBe("gemini-2.5-flash")

    await configBridge.clearTaskAiConfig("sceneDraft")
    const tasksAfterClear = values.get("tasks") as Record<string, { provider: string; model?: string }>
    expect(tasksAfterClear["sceneDraft"]).toBeUndefined()
    expect(tasksAfterClear["grammarCheck"]?.provider).toBe("google")
    expect(configBridge.getTaskProviderOverride("sceneDraft")).toBeNull()
    expect(configBridge.getTaskProviderOverride("grammarCheck")).toBe("google")

    await configBridge.setTaskAiConfig("grammarCheck", { providerId: null, model: null })
    const tasksAfterNull = values.get("tasks") as Record<string, { provider: string }>
    expect(tasksAfterNull["grammarCheck"]).toBeUndefined()
    expect(configBridge.getTaskProviderOverride("grammarCheck")).toBeNull()
  })

  it("writes provider model and Ollama base URL", async () => {
    const values = new Map<string, unknown>()
    const configuration = new MutableFakeConfiguration(values)
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => configuration
    })

    await configBridge.setProviderModel("openai", "gpt-5-mini")
    expect(values.get("providers.openai.model")).toBe("gpt-5-mini")

    await configBridge.setProviderBaseUrl("http://127.0.0.1:11434")
    expect(values.get("providers.ollama.baseUrl")).toBe("http://127.0.0.1:11434")

    await configBridge.setProviderCommand("claude-code", "/usr/local/bin/claude")
    expect(values.get("providers.claude-code.command")).toBe("/usr/local/bin/claude")

    await configBridge.setProviderCommand("codex", "/opt/codex")
    expect(values.get("providers.codex.command")).toBe("/opt/codex")
  })

  it("reads CLI provider command with defaults", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([["providers.claude-code.command", "/custom/claude"]])
    )

    expect(configBridge.getProviderConfig("claude-code")).toEqual({
      command: "/custom/claude",
      model: "sonnet"
    })
    expect(configBridge.getProviderConfig("codex")).toEqual({
      command: "codex",
      model: "gpt-5-codex"
    })
  })

  it("throws when update is not available on configuration", async () => {
    const configBridge = createConfigBridge(new Map())

    await expect(configBridge.setDefaultProvider("openai")).rejects.toThrow(/update is required/)
  })

  it("disables revise-after-generate by default and reads the configured value", () => {
    expect(createConfigBridge(new Map()).isReviseAfterGenerateEnabled()).toBe(false)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseAfterGenerate", true]])).isReviseAfterGenerateEnabled()
    ).toBe(true)
  })
})

function createConfigBridge(values: ReadonlyMap<string, unknown>): ConfigBridge {
  return new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(values)
  })
}
