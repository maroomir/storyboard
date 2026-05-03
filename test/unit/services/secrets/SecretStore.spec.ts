import { describe, expect, it } from "vitest"

import {
  createApiKeySecretKey,
  SecretStore,
  type StoryboardSecretStorageChangeEvent,
  type StoryboardSecretStorageLike
} from "../../../../src/services/secrets/SecretStore"

class FakeSecretStorage implements StoryboardSecretStorageLike {
  public readonly values = new Map<string, string>()
  private readonly listeners = new Set<(event: StoryboardSecretStorageChangeEvent) => void>()

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key)
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    this.emitChange(key)
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key)
    this.emitChange(key)
  }

  public onDidChange(
    listener: (event: StoryboardSecretStorageChangeEvent) => void
  ): { readonly dispose: () => void } {
    this.listeners.add(listener)

    return {
      dispose: (): void => {
        this.listeners.delete(listener)
      }
    }
  }

  private emitChange(key: string): void {
    for (const listener of this.listeners) {
      listener({ key })
    }
  }
}

describe("SecretStore", () => {
  it("stores and reads provider API keys under Storyboard namespaced keys", async () => {
    const secretStorage = new FakeSecretStorage()
    const secretStore = new SecretStore(secretStorage)

    await secretStore.setApiKey("openai", " sk-test ")

    expect(secretStorage.values.get(createApiKeySecretKey("openai"))).toBe("sk-test")
    expect(await secretStore.getApiKey("openai")).toBe("sk-test")
    expect(await secretStore.hasApiKey("openai")).toBe(true)
  })

  it("deletes an API key when an empty key is set", async () => {
    const secretStore = new SecretStore(new FakeSecretStorage())

    await secretStore.setApiKey("claude", "secret")
    await secretStore.setApiKey("claude", "   ")

    expect(await secretStore.hasApiKey("claude")).toBe(false)
  })

  it("notifies only the changed provider key", async () => {
    const secretStore = new SecretStore(new FakeSecretStorage())
    let openAiChangeCount = 0

    const disposable = secretStore.onDidChangeApiKey("openai", () => {
      openAiChangeCount += 1
    })

    await secretStore.setApiKey("claude", "secret")
    await secretStore.setApiKey("openai", "secret")
    disposable.dispose()
    await secretStore.deleteApiKey("openai")

    expect(openAiChangeCount).toBe(1)
  })
})
