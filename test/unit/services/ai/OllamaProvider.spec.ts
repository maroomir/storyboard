import { describe, expect, it } from "vitest"

import { AiProviderError } from "@/services/ai/AiProviderError"
import { OllamaProvider, type OllamaClientLike } from "@/services/ai/providers/OllamaProvider"

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
})

interface FakeOllamaClientOptions {
  readonly completionText?: string
  readonly promptEvalCount?: number
  readonly evalCount?: number
  readonly onGet?: (path: string) => void
  readonly onPost?: (path: string) => void
}

function createFakeOllamaClient(options: FakeOllamaClientOptions): OllamaClientLike {
  return {
    get: async (path): Promise<unknown> => {
      options.onGet?.(path)
      return {}
    },
    post: async (
      path
    ): Promise<{
      readonly message: { readonly content: string }
      readonly prompt_eval_count?: number
      readonly eval_count?: number
    }> => {
      options.onPost?.(path)
      return {
        message: { content: options.completionText ?? "ok" },
        ...(options.promptEvalCount !== undefined ? { prompt_eval_count: options.promptEvalCount } : {}),
        ...(options.evalCount !== undefined ? { eval_count: options.evalCount } : {})
      }
    }
  }
}
