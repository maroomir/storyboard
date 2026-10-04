import { describe, expect, it } from "vitest"

import { AiProviderError } from '@storyboard/story-model';
import { ClaudeProvider, computeCostUsd } from '@storyboard/story-ai';
import type { ClaudeClientLike } from '@storyboard/story-ai';
describe("ClaudeProvider", () => {
  it("requires an API key", () => {
    expect(() => new ClaudeProvider({ apiKey: undefined, model: "claude-sonnet-4-6" })).toThrow(
      AiProviderError
    )
  })

  it.each([
    ["claude-sonnet-5", undefined],
    ["claude-sonnet-4-6", 0.7]
  ] as const)("sends temperature to %s only when the model accepts it", async (model, expectedTemperature) => {
    let capturedRequest: Parameters<ClaudeClientLike["messages"]["create"]>[0] | undefined
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model,
      createClient: (): ClaudeClientLike =>
        createFakeClaudeClient({
          onCreateMessage: (request): void => {
            capturedRequest = request
          }
        })
    })

    await provider.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "장면을 써줘." }],
      temperature: 0.7
    })

    expect(capturedRequest?.temperature).toBe(expectedTemperature)
  })

  it.each([
    ["max_tokens", true],
    ["end_turn", undefined]
  ] as const)("reports a %s stop as truncated: %s", async (stopReason, expectedTruncation) => {
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5",
      createClient: (): ClaudeClientLike => createFakeClaudeClient({ completionText: '{"notes":[', stopReason })
    })

    const response = await provider.generate({
      taskName: "noteExtraction",
      messages: [{ role: "user", content: "노트" }]
    })

    expect(response.isTruncated).toBe(expectedTruncation)
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

  // 같은 역할이 이어지면 블록으로 합치고, 캐시 경계 메시지의 블록에만 cache_control 을 단다.
  it("merges consecutive same-role messages into blocks and marks the cache boundary", async () => {
    let capturedMessages: Parameters<ClaudeClientLike["messages"]["create"]>[0]["messages"] = []
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      createClient: (): ClaudeClientLike =>
        createFakeClaudeClient({
          onCreateMessage: (request): void => {
            capturedMessages = request.messages
          }
        })
    })

    await provider.generate({
      taskName: "draftCritique",
      messages: [
        { role: "system", content: "비평가다." },
        { role: "user", content: "원고 전문", cacheBoundary: true },
        { role: "user", content: "기준: 결말" },
        { role: "assistant", content: "{}" }
      ]
    })

    expect(capturedMessages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "원고 전문", cache_control: { type: "ephemeral" } },
          { type: "text", text: "기준: 결말" }
        ]
      },
      { role: "assistant", content: "{}" }
    ])
  })

  it("generates text and separates system prompts from conversation messages", async () => {
    let capturedSystem: Parameters<ClaudeClientLike["messages"]["create"]>[0]["system"]
    const usage = { inputTokens: 80, outputTokens: 40, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 }
    const provider = new ClaudeProvider({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      createClient: (): ClaudeClientLike =>
        createFakeClaudeClient({
          completionText: "클로드 응답",
          usage: {
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_read_input_tokens: usage.cacheReadInputTokens,
            cache_creation_input_tokens: usage.cacheCreationInputTokens
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
  readonly stopReason?: string
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
        readonly stop_reason?: string
      }> => {
        options.onCreateMessage?.(request)
        return {
          content: [{ type: "text", text: options.completionText ?? "ok" }],
          ...(options.usage !== undefined ? { usage: options.usage } : {}),
          ...(options.stopReason !== undefined ? { stop_reason: options.stopReason } : {})
        }
      }
    }
  }
}
