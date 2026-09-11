import { describe, expect, it } from "vitest"

import { AiProviderError, AiProviderRegistry, ConfigBridge, createAiProviderRegistry, SecretStore } from '@storyboard/story-ai';
import type { ClaudeClientLike, GoogleClientLike, OllamaClientLike, OpenAiClientLike, StoryboardConfigurationLike, StoryboardSecretStorageLike } from '@storyboard/story-ai';
describe("AiProviderRegistry", () => {
  it("lists all provider statuses and marks every Phase 3 provider as available", async () => {
    const registry = createRegistry()

    await expect(registry.listProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: "mock", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "openai", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "claude", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "google", hasApiKey: true, isAvailable: true }),
        expect.objectContaining({ providerId: "grok", hasApiKey: true, isAvailable: true }),
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

  // A workspace configured for a subscription CLI must keep working after those providers left.
  it("resolves a retired subscription-CLI default onto its metered replacement", async () => {
    const registry = createRegistry(new Map<string, unknown>([["defaultProvider", "claude-code"]]))

    const response = await registry.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "테스트" }]
    })

    expect(response.providerId).toBe("claude")
  })

  it("uses per-task model override for generate when stored in workspace tasks", async () => {
    const registry = createRegistry(
      new Map<string, unknown>([
        ["defaultProvider", "mock"],
        ["providers.claude.model", "claude-sonnet-4-6"],
        ["tasks", { sceneDraft: { provider: "claude", model: "claude-haiku-4-5" } }]
      ])
    )

    const response = await registry.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "테스트" }]
    })

    expect(response.providerId).toBe("claude")
    expect(response.model).toBe("claude-haiku-4-5")
  })

  it("uses the provider global model when the task overrides provider only", async () => {
    const registry = createRegistry(
      new Map<string, unknown>([
        ["defaultProvider", "mock"],
        ["providers.claude.model", "claude-sonnet-4-6"],
        ["tasks", { sceneDraft: { provider: "claude" } }]
      ])
    )

    const response = await registry.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "테스트" }]
    })

    expect(response.providerId).toBe("claude")
    expect(response.model).toBe("claude-sonnet-4-6")
  })

  it("exposes the resolved task provider for cache metadata", () => {
    const registry = createRegistry(
      new Map<string, unknown>([
        ["defaultProvider", "mock"],
        ["tasks.situationExtraction.provider", "claude"],
        ["tasks.personaGeneration.provider", "openai"],
        ["tasks.personaDialogue.provider", "google"],
        ["tasks.sceneDraft.provider", "ollama"]
      ])
    )

    expect(registry.getTaskProvider("situationExtraction")).toBe("claude")
    expect(registry.getTaskProvider("personaGeneration")).toBe("openai")
    expect(registry.getTaskProvider("personaDialogue")).toBe("google")
    expect(registry.getTaskProvider("sceneDraft")).toBe("ollama")
    expect(registry.getTaskProvider("traitsExtraction")).toBe("mock")
  })

  it("checks Claude, Google, Grok, and Ollama connections through registered clients", async () => {
    const registry = createRegistry()

    await expect(registry.checkConnection("claude")).resolves.toEqual({ ok: true })
    await expect(registry.checkConnection("google")).resolves.toEqual({ ok: true })
    await expect(registry.checkConnection("grok")).resolves.toEqual({ ok: true })
    await expect(registry.checkConnection("ollama")).resolves.toEqual({ ok: true })
  })

  it("reports missing provider keys with a normalized error", async () => {
    const registry = createRegistry(new Map(), new Map())

    await expect(registry.checkConnection("claude")).rejects.toMatchObject({
      code: "missing-api-key",
      providerId: "claude"
    })
  })

  // A fresh install used to generate against `mock` and exit clean; with the guard on, the same
  // call is refused until the author picks a provider, and a task override counts as a pick.
  it("refuses to resolve a task when no provider is configured and the guard is on", async () => {
    const guarded = createAiProviderRegistry({
      secretStore: new SecretStore(new FakeSecretStorage(new Map())),
      configBridge: new ConfigBridge({
        getConfiguration: (): StoryboardConfigurationLike =>
          new FakeConfiguration(new Map([["tasks", { grammarCheck: { provider: "mock" } }]]))
      }),
      requireConfiguredProvider: true
    })

    expect(() => guarded.getTaskProvider("sceneDraft")).toThrow(AiProviderError)
    await expect(
      guarded.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "missing-provider" })
    expect(guarded.isTaskProviderConfigured("sceneDraft")).toBe(false)

    expect(guarded.getTaskProvider("grammarCheck")).toBe("mock")
    expect(guarded.isTaskProviderConfigured("grammarCheck")).toBe(true)
  })

  it("keeps the mock fallback when the guard is off", () => {
    const registry = createRegistry(new Map(), new Map())

    expect(registry.getTaskProvider("sceneDraft")).toBe("mock")
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
    createOpenAiClient: (): OpenAiClientLike => createFakeOpenAiClient(),
    createGrokClient: (): OpenAiClientLike => createFakeOpenAiClient()
  })
}

function createDefaultSecretValues(): Map<string, string> {
  return new Map([
    ["storyboard.apiKey.openai", "sk-test"],
    ["storyboard.apiKey.claude", "sk-ant-test"],
    ["storyboard.apiKey.google", "google-test"],
    ["storyboard.apiKey.grok", "xai-test"]
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
