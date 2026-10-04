import { describe, expect, it } from "vitest"

import { AiProviderError } from '@storyboard/story-model';
import { OllamaProvider } from '@storyboard/story-ai';
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

  // 생각하는 모델은 상한 없이 생각하면 한 호출이 수십 분이 된다. 켜고 끄는 값이 그대로 가야 한다.
  it("passes the think flag through when one is set, and omits it otherwise", async () => {
    const bodies: Record<string, unknown>[] = []
    const client: OllamaClientLike = {
      get: async (): Promise<Record<string, unknown>> => ({}),
      post: async (_path, body): Promise<Record<string, unknown>> => {
        bodies.push(body as unknown as Record<string, unknown>)
        return { message: { content: "답" } }
      }
    }
    const request = { taskName: "sceneDraft" as const, messages: [{ role: "user" as const, content: "장면" }] }

    await new OllamaProvider({ baseUrl: "http://localhost:11434", model: "gemma4:12b", think: false, createClient: (): OllamaClientLike => client }).generate(request)
    await new OllamaProvider({ baseUrl: "http://localhost:11434", model: "gemma4:12b", createClient: (): OllamaClientLike => client }).generate(request)

    expect(bodies[0]?.["think"]).toBe(false)
    expect("think" in (bodies[1] ?? {})).toBe(false)
  })

  // 생각으로 출력 상한을 다 쓰면 본문이 빈 채 돌아온다. 빈 본문을 넘기면 빈 뼈대가 조용히 저장된다.
  it("fails loudly when thinking used up the output and no content came back", async () => {
    const client: OllamaClientLike = {
      get: async (): Promise<Record<string, unknown>> => ({}),
      post: async (): Promise<Record<string, unknown>> => ({
        message: { content: "", thinking: "생각 생각 생각" },
        eval_count: 8000
      })
    }
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "gemma4:12b", createClient: (): OllamaClientLike => client })

    await expect(
      provider.generate({ taskName: "sceneSkeleton", messages: [{ role: "user", content: "장면" }] })
    ).rejects.toMatchObject({ code: "generation-failed", message: expect.stringContaining("생각") })
  })

  it("generates text through /api/chat", async () => {
    let capturedPath = ""
    const usage = { inputTokens: 30, outputTokens: 70 }
    const providerWithUsage = new OllamaProvider({
      baseUrl: "http://localhost:11434",
      model: "gemma4:12b",
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
      model: "gemma4:12b",
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

  it.each([
    ["length", true],
    ["stop", undefined]
  ] as const)("reports a %s finish as truncated: %s", async (doneReason, expectedTruncation) => {
    const client: OllamaClientLike = {
      get: async (): Promise<Record<string, unknown>> => ({}),
      post: async (): Promise<Record<string, unknown>> => ({ message: { content: '{"notes":[' }, done_reason: doneReason })
    }
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "llama3.3", createClient: (): OllamaClientLike => client })

    const response = await provider.generate({ taskName: "noteExtraction", messages: [{ role: "user", content: "노트" }] })

    expect(response.isTruncated).toBe(expectedTruncation)
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
