import { describe, expect, it } from "vitest"

import { AiProviderError } from '@storyboard/story-model';
import { computeCostUsd, GrokProvider } from '@storyboard/story-ai';
import type { OpenAiClientLike } from '@storyboard/story-ai';
describe("GrokProvider", () => {
  it("requires an API key and a model", () => {
    expect(() => new GrokProvider({ apiKey: undefined, model: "grok-4.6" })).toThrow(AiProviderError)
    expect(() => new GrokProvider({ apiKey: "xai-test", model: undefined })).toThrow(AiProviderError)
  })

  it("checks connection through the OpenAI-compatible models.list", async () => {
    let didListModels = false
    const provider = new GrokProvider({
      apiKey: "xai-test",
      model: "grok-4.6",
      createClient: (): OpenAiClientLike => createFakeGrokClient({
        onListModels: (): void => {
          didListModels = true
        }
      })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(didListModels).toBe(true)
  })

  it("generates text through chat completions and prices the usage as grok", async () => {
    const usage = { inputTokens: 100, outputTokens: 50 }
    let captured: FakeGrokCreateRequest | undefined
    const provider = new GrokProvider({
      apiKey: "xai-test",
      model: "grok-4.6",
      createClient: (): OpenAiClientLike =>
        createFakeGrokClient({
          completionText: "생성된 원고",
          usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens },
          onCreate: (request): void => {
            captured = request
          }
        })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "지시문" },
        { role: "user", content: "장면을 써줘." }
      ],
      temperature: 0.4,
      maxTokens: 100
    })

    expect(captured).toEqual({
      model: "grok-4.6",
      messages: [
        { role: "system", content: "지시문" },
        { role: "user", content: "장면을 써줘." }
      ],
      temperature: 0.4,
      max_tokens: 100
    })
    expect(response).toEqual({
      providerId: "grok",
      model: "grok-4.6",
      text: "생성된 원고",
      usage,
      costUsd: computeCostUsd({ providerId: "grok", model: "grok-4.6", usage })
    })
  })

  it("wraps a failed completion as a generation-failed provider error", async () => {
    const provider = new GrokProvider({
      apiKey: "xai-test",
      model: "grok-4.6",
      createClient: (): OpenAiClientLike => ({
        models: { list: async (): Promise<unknown> => ({}) },
        chat: {
          completions: {
            create: async (): Promise<never> => {
              throw new Error("401 invalid api key")
            }
          }
        }
      })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "generation-failed", providerId: "grok" })
  })
})

interface FakeGrokCreateRequest {
  readonly model: string
  readonly messages: readonly { readonly role: string; readonly content: string }[]
  readonly temperature?: number
  readonly max_tokens?: number
}

interface FakeGrokClientOptions {
  readonly completionText?: string
  readonly onListModels?: () => void
  readonly onCreate?: (request: FakeGrokCreateRequest) => void
  readonly usage?: { readonly prompt_tokens: number; readonly completion_tokens: number }
}

function createFakeGrokClient(options: FakeGrokClientOptions): OpenAiClientLike {
  return {
    models: {
      list: async (): Promise<unknown> => {
        options.onListModels?.()
        return {}
      }
    },
    chat: {
      completions: {
        create: async (request: FakeGrokCreateRequest): Promise<{
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
