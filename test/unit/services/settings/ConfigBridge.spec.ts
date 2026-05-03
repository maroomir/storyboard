import { describe, expect, it } from "vitest"

import {
  ConfigBridge,
  type StoryboardConfigurationChangeEventLike,
  type StoryboardConfigurationLike
} from "../../../../src/services/settings/ConfigBridge"

class FakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: ReadonlyMap<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    return (this.values.has(section) ? this.values.get(section) : defaultValue) as T
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
})

function createConfigBridge(values: ReadonlyMap<string, unknown>): ConfigBridge {
  return new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(values)
  })
}
