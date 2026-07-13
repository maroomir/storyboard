import { describe, expect, it } from "vitest"

import { computeCostUsd } from "@/services/ai/cost"
import { AiProviderError } from "@/shared/aiProviderError"
import { GoogleProvider, type GoogleClientLike } from "@/services/ai/providers/GoogleProvider"

describe("GoogleProvider", () => {
  it("requires an API key", () => {
    expect(() => new GoogleProvider({ apiKey: undefined, model: "gemini-2.5-flash" })).toThrow(
      AiProviderError
    )
  })

  it("checks connection with a generated test prompt", async () => {
    let capturedPrompt = ""
    let capturedSystemInstruction: string | undefined
    const provider = new GoogleProvider({
      apiKey: "google-test",
      model: "gemini-2.5-flash",
      createClient: (): GoogleClientLike => createFakeGoogleClient({
        completionText: "ok",
        onGetGenerativeModel: (options): void => {
          capturedSystemInstruction = options.systemInstruction
        },
        onGenerateContent: (prompt): void => {
          capturedPrompt = prompt
        }
      })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(capturedPrompt).toBe("test")
    expect(capturedSystemInstruction).toBeUndefined()
  })

  it("passes system messages via systemInstruction and sends conversation content", async () => {
    let capturedPrompt = ""
    let capturedSystemInstruction: string | undefined
    const usage = { inputTokens: 120, outputTokens: 60 }
    const provider = new GoogleProvider({
      apiKey: "google-test",
      model: "gemini-2.5-flash",
      createClient: (): GoogleClientLike =>
        createFakeGoogleClient({
          completionText: "구글 응답",
          usageMetadata: {
            promptTokenCount: usage.inputTokens,
            candidatesTokenCount: usage.outputTokens
          },
          onGetGenerativeModel: (options): void => {
            capturedSystemInstruction = options.systemInstruction
          },
          onGenerateContent: (prompt): void => {
            capturedPrompt = prompt
          }
        })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "너는 작가다." },
        { role: "user", content: "장면을 써줘." }
      ]
    })

    expect(capturedSystemInstruction).toBe("너는 작가다.")
    expect(capturedPrompt).toBe("장면을 써줘.")
    expect(response).toEqual({
      providerId: "google",
      model: "gemini-2.5-flash",
      text: "구글 응답",
      usage,
      costUsd: computeCostUsd({ providerId: "google", model: "gemini-2.5-flash", usage })
    })
  })
})

interface FakeGoogleClientOptions {
  readonly completionText: string
  readonly usageMetadata?: { readonly promptTokenCount: number; readonly candidatesTokenCount: number }
  readonly onGetGenerativeModel?: (options: {
    readonly model: string
    readonly systemInstruction?: string
    readonly generationConfig?: {
      readonly temperature?: number
      readonly maxOutputTokens?: number
    }
  }) => void
  readonly onGenerateContent?: (prompt: string) => void
}

function createFakeGoogleClient(options: FakeGoogleClientOptions): GoogleClientLike {
  return {
    getGenerativeModel: (modelOptions) => ({
      generateContent: async (
        prompt
      ): Promise<{
        readonly response: {
          readonly text: () => string
          readonly usageMetadata?: FakeGoogleClientOptions["usageMetadata"]
        }
      }> => {
        options.onGetGenerativeModel?.(modelOptions)
        options.onGenerateContent?.(prompt)
        return {
          response: {
            text: (): string => options.completionText,
            ...(options.usageMetadata !== undefined ? { usageMetadata: options.usageMetadata } : {})
          }
        }
      }
    })
  }
}
