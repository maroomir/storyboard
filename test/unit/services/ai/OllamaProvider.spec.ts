import { describe, expect, it } from "vitest"

import { AiProviderError } from "../../../../src/services/ai/AiProviderError"
import { OllamaProvider, type OllamaClientLike } from "../../../../src/services/ai/providers/OllamaProvider"

describe("OllamaProvider", () => {
  it("requires a base URL", () => {
    expect(() => new OllamaProvider({ baseUrl: undefined, model: "llama3.1" })).toThrow(AiProviderError)
  })

  it("checks connection through /api/tags", async () => {
    let capturedPath = ""
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
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
    const provider = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "llama3.1",
      createClient: (): OllamaClientLike => createFakeOllamaClient({
        completionText: "올라마 응답",
        onPost: (path): void => {
          capturedPath = path
        }
      })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "장면" }]
    })

    expect(capturedPath).toBe("/api/chat")
    expect(response).toEqual({
      providerId: "ollama",
      model: "llama3.1",
      text: "올라마 응답"
    })
  })
})

interface FakeOllamaClientOptions {
  readonly completionText?: string
  readonly onGet?: (path: string) => void
  readonly onPost?: (path: string) => void
}

function createFakeOllamaClient(options: FakeOllamaClientOptions): OllamaClientLike {
  return {
    get: async (path): Promise<unknown> => {
      options.onGet?.(path)
      return {}
    },
    post: async (path): Promise<{ readonly message: { readonly content: string } }> => {
      options.onPost?.(path)
      return { message: { content: options.completionText ?? "ok" } }
    }
  }
}
