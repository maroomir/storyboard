import { describe, expect, it } from "vitest"

import { ConfigBridge } from '@storyboard/story-ai';
import type { StoryboardConfigurationChangeEventLike, StoryboardConfigurationLike } from '@storyboard/story-ai';

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

  // 로컬 태그는 사용자가 내려받은 것이다. 카탈로그에서 빠졌다고 다른 모델로 바꿔 부르면 안 된다.
  it("keeps a configured ollama model even when the catalog does not list it", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "ollama"],
        ["providers.ollama.model", "qwen3:14b"]
      ])
    )

    expect(configBridge.getTaskAiConfig("backgroundDescription")).toEqual({
      providerId: "ollama",
      model: "qwen3:14b"
    })
  })

  it("reads the ollama think flag and the prompt variant override", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["providers.ollama.think", false],
        ["promptVariant", "rich"]
      ])
    )

    expect(configBridge.getProviderConfig("ollama").think).toBe(false)
    expect(configBridge.getPromptVariantOverride()).toBe("rich")
  })

  it("ignores a prompt variant it does not know", () => {
    const configBridge = createConfigBridge(new Map<string, unknown>([["promptVariant", "huge"]]))

    expect(configBridge.getPromptVariantOverride()).toBeUndefined()
    expect(configBridge.getProviderConfig("ollama").think).toBeUndefined()
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
  })

  // A config file written before the subscription CLIs left still names one. It now reads as no
  // choice at all rather than as a different provider — the author picks again knowingly.
  it("reads a retired subscription-CLI provider as unconfigured", () => {
    const configBridge = createConfigBridge(
      new Map<string, unknown>([
        ["defaultProvider", "claude-code"],
        ["tasks", { grammarCheck: { provider: "gemini-cli" } }]
      ])
    )

    expect(configBridge.isDefaultProviderConfigured()).toBe(false)
    expect(configBridge.getTaskProviderOverride("grammarCheck")).toBeNull()
  })

  it("still reports an unknown provider as unconfigured", () => {
    const configBridge = createConfigBridge(new Map<string, unknown>([["defaultProvider", "nope"]]))

    expect(configBridge.isDefaultProviderConfigured()).toBe(false)
    expect(configBridge.getDefaultProvider()).toBe("mock")
  })

  it("throws when update is not available on configuration", async () => {
    const configBridge = createConfigBridge(new Map())

    await expect(configBridge.setDefaultProvider("openai")).rejects.toThrow(/update is required/)
  })

  it("enables revise-after-generate by default and reads the configured value", () => {
    expect(createConfigBridge(new Map()).isReviseAfterGenerateEnabled()).toBe(true)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseAfterGenerate", false]])).isReviseAfterGenerateEnabled()
    ).toBe(false)
  })

  it("clamps revise max iterations to [1, 5] with a default of 2", () => {
    expect(createConfigBridge(new Map()).getReviseMaxIterations()).toBe(2)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseMaxIterations", 0]])).getReviseMaxIterations()
    ).toBe(1)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseMaxIterations", 9]])).getReviseMaxIterations()
    ).toBe(5)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseMaxIterations", 3]])).getReviseMaxIterations()
    ).toBe(3)
  })

  it("reads the scene beats switches with clamped defaults", () => {
    expect(createConfigBridge(new Map()).isAutoBeatsEnabled()).toBe(true)
    expect(createConfigBridge(new Map<string, unknown>([["draft.autoBeats", false]])).isAutoBeatsEnabled()).toBe(false)
    expect(createConfigBridge(new Map()).getCharsPerBeat()).toBe(1500)
    expect(createConfigBridge(new Map<string, unknown>([["draft.charsPerBeat", 10]])).getCharsPerBeat()).toBe(300)
    expect(createConfigBridge(new Map<string, unknown>([["draft.charsPerBeat", 2000]])).getCharsPerBeat()).toBe(2000)
    expect(createConfigBridge(new Map()).getMinBeats()).toBe(5)
    expect(createConfigBridge(new Map<string, unknown>([["draft.minBeats", 0]])).getMinBeats()).toBe(1)
    expect(createConfigBridge(new Map<string, unknown>([["draft.minBeats", 8]])).getMinBeats()).toBe(8)
  })

  it("clamps revise score threshold to [0, 100] with a default of 0", () => {
    expect(createConfigBridge(new Map()).getReviseScoreThreshold()).toBe(0)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseScoreThreshold", -5]])).getReviseScoreThreshold()
    ).toBe(0)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseScoreThreshold", 150]])).getReviseScoreThreshold()
    ).toBe(100)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.reviseScoreThreshold", 42]])).getReviseScoreThreshold()
    ).toBe(42)
  })

  it("clamps max compression percent to [0, 90] with a default of 50", () => {
    expect(createConfigBridge(new Map()).getMaxCompressionPercent()).toBe(50)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.maxCompressionPercent", -5]])).getMaxCompressionPercent()
    ).toBe(0)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.maxCompressionPercent", 100]])).getMaxCompressionPercent()
    ).toBe(90)
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.maxCompressionPercent", 42]])).getMaxCompressionPercent()
    ).toBe(42)
  })

  it("disables update-cards-after-generate by default and reads the configured value", () => {
    expect(createConfigBridge(new Map()).isUpdateCardsAfterGenerateEnabled()).toBe(false)
    expect(
      createConfigBridge(
        new Map<string, unknown>([["draft.updateCardsAfterGenerate", true]])
      ).isUpdateCardsAfterGenerateEnabled()
    ).toBe(true)
  })

  it("returns the scene break separator only when the scene break is enabled", () => {
    expect(createConfigBridge(new Map()).getDraftSceneBreakSeparator()).toBeUndefined()
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.sceneBreakEnabled", false]])).getDraftSceneBreakSeparator()
    ).toBeUndefined()
    expect(
      createConfigBridge(new Map<string, unknown>([["draft.sceneBreakEnabled", true]])).getDraftSceneBreakSeparator()
    ).toBe("---")
    expect(
      createConfigBridge(
        new Map<string, unknown>([
          ["draft.sceneBreakEnabled", true],
          ["draft.sceneBreakSeparator", "3"]
        ])
      ).getDraftSceneBreakSeparator()
    ).toBe("3")
  })

  it("tells a configured default provider apart from the mock fallback", () => {
    expect(createConfigBridge(new Map()).isDefaultProviderConfigured()).toBe(false)
    expect(createConfigBridge(new Map([["defaultProvider", "nope"]])).isDefaultProviderConfigured()).toBe(false)
    expect(createConfigBridge(new Map([["defaultProvider", "mock"]])).isDefaultProviderConfigured()).toBe(true)
  })

  it("exposes realtime and studio validation switches with their defaults", () => {
    const configBridge = createConfigBridge(new Map())

    expect(configBridge.isSlopRealtimeEnabled()).toBe(false)
    expect(configBridge.isStudioValidationEnabled()).toBe(true)
    expect(
      createConfigBridge(new Map([["slop.realtimeEnabled", true], ["studio.validation", false]])).isSlopRealtimeEnabled()
    ).toBe(true)
  })

  // A write lands in the layer the author is looking at: the workspace file only when it already
  // holds the key, otherwise the shared home file.
  it("writes to the workspace layer only when the key already lives there", async () => {
    const targets: Array<[string, number | undefined]> = []
    const configuration: StoryboardConfigurationLike = {
      get: <T>(_section: string, defaultValue: T): T => defaultValue,
      inspect: <T>(section: string): { globalValue?: T; workspaceValue?: T } =>
        section === "providers.openai.model"
          ? { workspaceValue: "gpt-5-mini" as T }
          : section === "defaultProvider"
            ? { globalValue: "codex" as T }
            : {},
      update: async (section, _value, target): Promise<void> => {
        targets.push([section, target])
      }
    }
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => configuration
    })

    await configBridge.setProviderModel("openai", "gpt-5-nano")
    await configBridge.setDefaultProvider("openai")

    expect(targets).toEqual([["providers.openai.model", 2], ["defaultProvider", 1]])
    expect(configBridge.getValueOrigin("providers.openai.model")).toBe("workspace")
    expect(configBridge.getValueOrigin("defaultProvider")).toBe("user")
    expect(configBridge.getValueOrigin("draft.keepHistory")).toBe("default")
  })
})

function createConfigBridge(values: ReadonlyMap<string, unknown>): ConfigBridge {
  return new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(values)
  })
}
