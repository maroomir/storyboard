import { describe, expect, it } from "vitest"

import { AiProviderError, OllamaProvider } from '@storyboard/story-ai';
import type { OllamaClientLike } from '@storyboard/story-ai';
describe("OllamaProvider", () => {
  it("requires a base URL", () => {
    expect(() => new OllamaProvider({ baseUrl: undefined, model: "llama3.3" })).toThrow(AiProviderError)
  })

  it("checks connection through /api/tags", async () => {
    let capturedPath = ""
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.3",
      createClient: (): OllamaClientLike => createFakeOllamaClient({
        onGet: (path): void => {
          capturedPath = path
        }
      })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(capturedPath).toBe("/api/tags")
  })

  it("generates text through /api/chat", async () => {
    let capturedPath = ""
    const usage = { inputTokens: 30, outputTokens: 70 }
    const providerWithUsage = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.3",
      createClient: (): OllamaClientLike =>
        createFakeOllamaClient({
          completionText: "올라마 응답",
          promptEvalCount: usage.inputTokens,
          evalCount: usage.outputTokens,
          onPost: (path): void => {
            capturedPath = path
          }
        })
    })

    const response = await providerWithUsage.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "장면" }]
    })

    expect(capturedPath).toBe("/api/chat")
    expect(response).toEqual({
      providerId: "ollama",
      model: "llama3.3",
      text: "올라마 응답",
      usage,
      costUsd: 0
    })
  })

  it("forwards system role messages to /api/chat without merging into user", async () => {
    let capturedMessages: readonly { readonly role: string; readonly content: string }[] = []
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.3",
      createClient: (): OllamaClientLike =>
        createFakeOllamaClient({
          completionText: "ok",
          onPost: (_path, body): void => {
            capturedMessages = body.messages
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

    expect(capturedMessages).toEqual([
      { role: "system", content: "지시문" },
      { role: "user", content: "본문" }
    ])
  })
})

interface FakeOllamaPostBody {
  readonly messages: readonly { readonly role: string; readonly content: string }[]
}

interface FakeOllamaClientOptions {
  readonly completionText?: string
  readonly promptEvalCount?: number
  readonly evalCount?: number
  readonly onGet?: (path: string) => void
  readonly onPost?: (path: string, body: FakeOllamaPostBody) => void
}

function createFakeOllamaClient(options: FakeOllamaClientOptions): OllamaClientLike {
  return {
    get: async (path): Promise<unknown> => {
      options.onGet?.(path)
      return {}
    },
    post: async (
      path,
      body
    ): Promise<{
      readonly message: { readonly content: string }
      readonly prompt_eval_count?: number
      readonly eval_count?: number
    }> => {
      options.onPost?.(path, body as FakeOllamaPostBody)
      return {
        message: { content: options.completionText ?? "ok" },
        ...(options.promptEvalCount !== undefined ? { prompt_eval_count: options.promptEvalCount } : {}),
        ...(options.evalCount !== undefined ? { eval_count: options.evalCount } : {})
      }
    }
  }
}
