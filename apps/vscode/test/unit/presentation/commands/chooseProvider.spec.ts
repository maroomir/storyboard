import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConfigBridge, SecretStore } from "@storyboard/story-ai"
import type { AiProviderRegistry, StoryboardConfigurationLike, StoryboardSecretStorageLike } from "@storyboard/story-ai"

import { chooseDefaultProvider, nudgeToChooseProvider } from "@/presentation/commands/chooseProvider"

function createConfigBridge(values: Map<string, unknown>): ConfigBridge {
  const configuration: StoryboardConfigurationLike = {
    get: <T>(section: string, defaultValue: T): T => (values.has(section) ? (values.get(section) as T) : defaultValue),
    update: async (section, value): Promise<void> => {
      values.set(section, value)
    }
  }
  return new ConfigBridge({ getConfiguration: (): StoryboardConfigurationLike => configuration })
}

function createSecretStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  const storage: StoryboardSecretStorageLike = {
    get: async (key) => values.get(key),
    store: async (key, value): Promise<void> => {
      values.set(key, value)
    },
    delete: async (key): Promise<void> => {
      values.delete(key)
    }
  }
  return Object.assign(new SecretStore(storage), { values })
}

const registry = {
  listProviders: async () => [
    { providerId: "openai", displayName: "OpenAI", hasApiKey: false, isAvailable: true },
    { providerId: "ollama", displayName: "Ollama", hasApiKey: true, isAvailable: true, model: "llama3.3" },
    { providerId: "mock", displayName: "Mock", hasApiKey: false, isAvailable: true }
  ]
} as unknown as AiProviderRegistry

afterEach(() => {
  vi.restoreAllMocks()
})

describe("chooseDefaultProvider", () => {
  it("stores the picked provider and asks for a key when the provider needs one", async () => {
    const values = new Map<string, unknown>()
    const configBridge = createConfigBridge(values)
    const secretStore = createSecretStore()
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation(async (items: unknown) => {
      const list = items as Array<{ providerId: string; description?: string }>
      expect(list.find((item) => item.providerId === "openai")?.description).toBe("API 키 필요")
      expect(list.find((item) => item.providerId === "ollama")?.description).toBe("로컬")
      return list.find((item) => item.providerId === "openai")
    })
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("sk-new")

    const picked = await chooseDefaultProvider({ configBridge, registry, secretStore })

    expect(picked).toBe("openai")
    expect(values.get("defaultProvider")).toBe("openai")
    expect(secretStore.values.get("storyboard.apiKey.openai")).toBe("sk-new")
  })

  it("does not prompt for a key on a keyless provider and leaves config alone on cancel", async () => {
    const values = new Map<string, unknown>()
    const secretStore = createSecretStore()
    const inputBox = vi.spyOn(vscode.window, "showInputBox")
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation(async (items: unknown) =>
      (items as Array<{ providerId: string }>).find((item) => item.providerId === "ollama")
    )

    await chooseDefaultProvider({ configBridge: createConfigBridge(values), registry, secretStore })
    expect(values.get("defaultProvider")).toBe("ollama")
    expect(inputBox).not.toHaveBeenCalled()

    vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined)
    const untouched = new Map<string, unknown>()
    const cancelled = await chooseDefaultProvider({ configBridge: createConfigBridge(untouched), registry, secretStore })
    expect(cancelled).toBeUndefined()
    expect(untouched.size).toBe(0)
  })

  it("hides the mock provider unless it is already the default", async () => {
    const offeredIds: string[][] = []
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation(async (items: unknown) => {
      offeredIds.push((items as Array<{ providerId: string }>).map((item) => item.providerId))
      return undefined
    })
    const secretStore = createSecretStore()

    await chooseDefaultProvider({ configBridge: createConfigBridge(new Map()), registry, secretStore })
    await chooseDefaultProvider({
      configBridge: createConfigBridge(new Map([["defaultProvider", "mock"]])),
      registry,
      secretStore
    })

    expect(offeredIds[0]).not.toContain("mock")
    expect(offeredIds[0]).toContain("openai")
    expect(offeredIds[1]).toContain("mock")
  })
})

describe("nudgeToChooseProvider", () => {
  it("stays silent once a provider is configured", async () => {
    const info = vi.spyOn(vscode.window, "showInformationMessage")

    await nudgeToChooseProvider({
      configBridge: createConfigBridge(new Map([["defaultProvider", "mock"]])),
      registry,
      secretStore: createSecretStore()
    })

    expect(info).not.toHaveBeenCalled()
  })

  it("offers to choose when nothing is configured", async () => {
    const values = new Map<string, unknown>()
    vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue("제공자 선택")
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation(async (items: unknown) =>
      (items as Array<{ providerId: string }>).find((item) => item.providerId === "ollama")
    )

    await nudgeToChooseProvider({ configBridge: createConfigBridge(values), registry, secretStore: createSecretStore() })

    expect(values.get("defaultProvider")).toBe("ollama")
  })
})
