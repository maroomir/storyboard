import { describe, expect, it } from "vitest"

import { AiProviderError } from "../../../../src/services/ai/AiProviderError"
import { ClaudeProvider, type ClaudeClientLike } from "../../../../src/services/ai/providers/ClaudeProvider"

describe("ClaudeProvider", () => {
  it("requires an API key", () => {
    expect(() => new ClaudeProvider({ apiKey: undefined, model: "claude-3-5-sonnet-latest" })).toThrow(
      AiProviderError
    )
  })

  it("checks connection through Claude messages.create", async () => {
    let didCreateMessage = false
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-3-5-sonnet-latest",
      createClient: (): ClaudeClientLike => createFakeClaudeClient({
        onCreateMessage: (): void => {
          didCreateMessage = true
        }
      })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(didCreateMessage).toBe(true)
  })

  it("generates text and separates system prompts from conversation messages", async () => {
    let capturedSystem: string | undefined
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-3-5-sonnet-latest",
      createClient: (): ClaudeClientLike => createFakeClaudeClient({
        completionText: "클로드 응답",
        onCreateMessage: (request): void => {
          capturedSystem = request.system
        }
      })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "너는 소설가다." },
        { role: "user", content: "장면을 써줘." }
      ]
    })

    expect(capturedSystem).toBe("너는 소설가다.")
    expect(response).toEqual({
      providerId: "claude",
      model: "claude-3-5-sonnet-latest",
      text: "클로드 응답"
    })
  })
})

interface FakeClaudeClientOptions {
  readonly completionText?: string
  readonly onCreateMessage?: (request: Parameters<ClaudeClientLike["messages"]["create"]>[0]) => void
}

function createFakeClaudeClient(options: FakeClaudeClientOptions): ClaudeClientLike {
  return {
    messages: {
      create: async (request): Promise<{ readonly content: readonly [{ readonly type: "text"; readonly text: string }] }> => {
        options.onCreateMessage?.(request)
        return { content: [{ type: "text", text: options.completionText ?? "ok" }] }
      }
    }
  }
}
