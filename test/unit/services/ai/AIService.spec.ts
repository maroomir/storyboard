import { describe, expect, it } from "vitest"

import { StoryboardAIService } from "../../../../src/services/ai/AIService"
import { createAiProviderRegistry } from "../../../../src/services/ai/providerRegistry"
import { type OpenAiClientLike } from "../../../../src/services/ai/providers/OpenAiProvider"
import { SecretStore, type StoryboardSecretStorageLike } from "../../../../src/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "../../../../src/services/settings/ConfigBridge"

describe("StoryboardAIService", () => {
  it("extracts situations from JSON-shaped model output", async () => {
    const service = createAIService({
      completionText:
        '[{"characters":["엘리아","지훈"],"situation":"엘리아와 지훈이 교실에서 대화한다."}]'
    })

    await expect(service.extractSituations("엘리아와 지훈이 교실에서 대화한다.")).resolves.toEqual([
      {
        characters: ["엘리아", "지훈"],
        situation: "엘리아와 지훈이 교실에서 대화한다."
      }
    ])
  })

  it("builds persona and genre-format requests through the registry", async () => {
    const service = createAIService({ completionText: "나는 엘리아다." })

    await expect(
      service.createCharacterPersona({
        type: "character",
        id: "elia",
        name: "엘리아",
        description: "주인공",
        tags: [],
        traits: ["용감함"],
        relations: [],
        arc: [],
        recentDialogues: []
      })
    ).resolves.toBe("나는 엘리아다.")
  })
})

function createAIService(options: { readonly completionText: string }): StoryboardAIService {
  const secretStore = new SecretStore(new FakeSecretStorage(new Map([["storyboard.apiKey.openai", "sk-test"]])))
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike =>
      new FakeConfiguration(
        new Map<string, unknown>([
          ["defaultProvider", "openai"],
          ["providers.openai.model", "gpt-4o-mini"]
        ])
      )
  })

  return new StoryboardAIService(
    createAiProviderRegistry({
      secretStore,
      configBridge,
      createOpenAiClient: (): OpenAiClientLike => ({
        models: {
          list: async (): Promise<unknown> => ({})
        },
        chat: {
          completions: {
            create: async (): Promise<{ readonly choices: readonly [{ readonly message: { readonly content: string } }] }> => ({
              choices: [{ message: { content: options.completionText } }]
            })
          }
        }
      })
    })
  )
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
