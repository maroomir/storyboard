import { describe, expect, it } from "vitest"

import { AiProviderError } from "../../../../src/services/ai/AiProviderError"
import { AiProviderRegistry, createAiProviderRegistry } from "../../../../src/services/ai/providerRegistry"
import { type OpenAiClientLike } from "../../../../src/services/ai/providers/OpenAiProvider"
import { SecretStore, type StoryboardSecretStorageLike } from "../../../../src/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "../../../../src/services/settings/ConfigBridge"

describe("AiProviderRegistry", () => {
  it("lists all provider statuses and marks PR-3b providers as available", async () => {
    const registry = createRegistry()

    await expect(registry.listProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "mock", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "openai", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "claude", isAvailable: false })
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

  it("reports unregistered providers with a normalized error", async () => {
    const registry = createRegistry()

    await expect(registry.checkConnection("claude")).rejects.toMatchObject<Partial<AiProviderError>>({
      code: "provider-not-registered",
      providerId: "claude"
    })
  })
})

function createRegistry(configuration = new Map<string, unknown>()): AiProviderRegistry {
  const secretStore = new SecretStore(new FakeSecretStorage(new Map([["storyboard.apiKey.openai", "sk-test"]])))
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => new FakeConfiguration(configuration)
  })

  return createAiProviderRegistry({
    secretStore,
    configBridge,
    createOpenAiClient: (): OpenAiClientLike => createFakeOpenAiClient()
  })
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
