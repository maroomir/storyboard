import { describe, expect, it } from "vitest"

import { computeCostUsd } from "@/infrastructure/ai/cost"
import { AiProviderError } from "@/shared/aiProviderError"
import { ClaudeProvider, type ClaudeClientLike } from "@/infrastructure/ai/providers/ClaudeProvider"

describe("ClaudeProvider", () => {
  it("requires an API key", () => {
    expect(() => new ClaudeProvider({ apiKey: undefined, model: "claude-sonnet-4-6" })).toThrow(
      AiProviderError
    )
  })

  it("checks connection through Claude messages.create", async () => {
    let didCreateMessage = false
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
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
    let capturedSystem: Parameters<ClaudeClientLike["messages"]["create"]>[0]["system"]
    const usage = { inputTokens: 80, outputTokens: 40 }
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      createClient: (): ClaudeClientLike =>
        createFakeClaudeClient({
          completionText: "클로드 응답",
          usage: {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5
          },
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

    expect(capturedSystem).toEqual([
      {
        type: "text",
        text: "너는 소설가다.",
        cache_control: { type: "ephemeral" }
      }
    ])
    expect(response).toEqual({
      providerId: "claude",
      model: "claude-sonnet-4-6",
      text: "클로드 응답",
      usage: {
        inputTokens: 80,
        outputTokens: 40,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5
      },
      costUsd: computeCostUsd({ providerId: "claude", model: "claude-sonnet-4-6", usage })
    })
  })
})

interface FakeClaudeClientOptions {
  readonly completionText?: string
  readonly usage?: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
  readonly onCreateMessage?: (request: Parameters<ClaudeClientLike["messages"]["create"]>[0]) => void
}

function createFakeClaudeClient(options: FakeClaudeClientOptions): ClaudeClientLike {
  return {
    messages: {
      create: async (
        request
      ): Promise<{
        readonly content: readonly [{ readonly type: "text"; readonly text: string }]
        readonly usage?: FakeClaudeClientOptions["usage"]
      }> => {
        options.onCreateMessage?.(request)
        return {
          content: [{ type: "text", text: options.completionText ?? "ok" }],
          ...(options.usage !== undefined ? { usage: options.usage } : {})
        }
      }
    }
  }
}
