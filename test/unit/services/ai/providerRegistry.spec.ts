import { describe, expect, it } from "vitest"

import { AiProviderRegistry, createAiProviderRegistry } from "../../../../src/services/ai/providerRegistry"
import { type ClaudeClientLike } from "../../../../src/services/ai/providers/ClaudeProvider"
import { type GoogleClientLike } from "../../../../src/services/ai/providers/GoogleProvider"
import { type OllamaClientLike } from "../../../../src/services/ai/providers/OllamaProvider"
import { type OpenAiClientLike } from "../../../../src/services/ai/providers/OpenAiProvider"
import { SecretStore, type StoryboardSecretStorageLike } from "../../../../src/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "../../../../src/services/settings/ConfigBridge"

describe("AiProviderRegistry", () => {
  it("lists all provider statuses and marks every Phase 3 provider as available", async () => {
    const registry = createRegistry()

    await expect(registry.listProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "mock", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "openai", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "claude", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "google", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "ollama", hasApiKey: true, isAvailable: true })
      ])
    )
  })

  it("uses the configured task provider when generate is called without explicit provider", async () => {
    const registry = createRegistry(
      new Map<string, unknown>([
        ["defaultProvider", "mock"],
        ["tasks.sceneDraft.provider", "mock"]
      ])
    )

    const response = await registry.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "테스트" }]
    })

    expect(response.providerId).toBe("mock")
  })

  it("exposes the resolved task provider for cache metadata", () => {
    const registry = createRegistry(
      new Map<string, unknown>([
        ["defaultProvider", "mock"],
        ["tasks.situationExtraction.provider", "claude"],
        ["tasks.personaDialogue.provider", "google"],
        ["tasks.sceneDraft.provider", "ollama"]
      ])
    )

    expect(registry.getTaskProvider("situationExtraction")).toBe("claude")
    expect(registry.getTaskProvider("personaDialogue")).toBe("google")
    expect(registry.getTaskProvider("sceneDraft")).toBe("ollama")
    expect(registry.getTaskProvider("traitsExtraction")).toBe("mock")
  })

  it("checks Claude, Google, and Ollama connections through registered clients", async () => {
    const registry = createRegistry()

    await expect(registry.checkConnection("claude")).resolves.toBe(true)
    await expect(registry.checkConnection("google")).resolves.toBe(true)
    await expect(registry.checkConnection("ollama")).resolves.toBe(true)
  })

  it("reports missing provider keys with a normalized error", async () => {
    const registry = createRegistry(new Map(), new Map())

    await expect(registry.checkConnection("claude")).rejects.toMatchObject({
      code: "missing-api-key",
      providerId: "claude"
    })
  })
})

function createRegistry(
  configuration = new Map<string, unknown>(),
  secretValues = createDefaultSecretValues()
): AiProviderRegistry {
  const secretStore = new SecretStore(new FakeSecretStorage(secretValues))
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(configuration)
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

function createDefaultSecretValues(): Map<string, string> {
  return new Map([
    ["storyboard.apiKey.openai", "sk-test"],
    ["storyboard.apiKey.claude", "sk-ant-test"],
    ["storyboard.apiKey.google", "google-test"]
  ])
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

class FakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: ReadonlyMap<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    return (this.values.has(section) ? this.values.get(section) : defaultValue) as T
  }
}

function createFakeOpenAiClient(): OpenAiClientLike {
  return {
    models: {
      list: async (): Promise<unknown> => ({})
    },
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
