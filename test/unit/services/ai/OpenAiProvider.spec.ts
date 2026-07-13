import { describe, expect, it } from "vitest"

import { computeCostUsd } from "@/services/ai/cost"
import { AiProviderError } from "@/shared/aiProviderError"
import { OpenAiProvider, type OpenAiClientLike } from "@/services/ai/providers/OpenAiProvider"

describe("OpenAiProvider", () => {
  it("requires an API key", () => {
    expect(() => new OpenAiProvider({ apiKey: undefined, model: "gpt-5.4-mini" })).toThrow(AiProviderError)
  })

  it("checks connection through OpenAI models.list", async () => {
    let didListModels = false
    const provider = new OpenAiProvider({
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      createClient: (): OpenAiClientLike => createFakeOpenAiClient({
        onListModels: (): void => {
          didListModels = true
        }
      })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(didListModels).toBe(true)
  })

  it("generates text through OpenAI chat completions", async () => {
    const usage = { inputTokens: 100, outputTokens: 50 }
    const provider = new OpenAiProvider({
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      createClient: (): OpenAiClientLike =>
        createFakeOpenAiClient({
          completionText: "생성된 원고",
          usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens }
        })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "장면을 써줘." }],
      temperature: 0.4,
      maxTokens: 100
    })

    expect(response).toEqual({
      providerId: "openai",
      model: "gpt-5.4-mini",
      text: "생성된 원고",
      usage,
      costUsd: computeCostUsd({ providerId: "openai", model: "gpt-5.4-mini", usage })
    })
  })

  it("forwards system role messages to OpenAI without merging into user", async () => {
    let captured: { readonly messages: readonly { readonly role: string; readonly content: string }[] } | undefined
    const provider = new OpenAiProvider({
      apiKey: "sk-test",
      model: "gpt-5.4-mini",
      createClient: (): OpenAiClientLike =>
        createFakeOpenAiClient({
          completionText: "ok",
          onCreate: (request): void => {
            captured = request
          }
        })
    })

    await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "지시문" },
        { role: "user", content: "본문" }
      ]
    })

    expect(captured?.messages).toEqual([
      { role: "system", content: "지시문" },
      { role: "user", content: "본문" }
    ])
  })
})

interface FakeOpenAiCreateRequest {
  readonly messages: readonly { readonly role: string; readonly content: string }[]
}

interface FakeOpenAiClientOptions {
  readonly completionText?: string
  readonly onListModels?: () => void
  readonly onCreate?: (request: FakeOpenAiCreateRequest) => void
  readonly usage?: { readonly prompt_tokens: number; readonly completion_tokens: number }
}

function createFakeOpenAiClient(options: FakeOpenAiClientOptions): OpenAiClientLike {
  return {
    models: {
      list: async (): Promise<unknown> => {
        options.onListModels?.()
        return {}
      }
    },
    chat: {
      completions: {
        create: async (request: FakeOpenAiCreateRequest): Promise<{
          readonly choices: readonly [{ readonly message: { readonly content: string } }]
          readonly usage?: { readonly prompt_tokens: number; readonly completion_tokens: number }
        }> => {
          options.onCreate?.(request)
          return {
            choices: [{ message: { content: options.completionText ?? "" } }],
            ...(options.usage !== undefined ? { usage: options.usage } : {})
          }
        }
      }
    }
  }
}
