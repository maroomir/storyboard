import { describe, expect, it } from "vitest"

import {
  aiGenerateResponseWithUsage,
  computeCostUsd
} from "@/services/ai/cost"

describe("computeCostUsd", () => {
  it("returns 0 when model is missing from the catalog", () => {
    expect(
      computeCostUsd({
        providerId: "openai",
        model: "unknown-model",
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
      })
    ).toBe(0)
  })

  it("returns 0 when usage is undefined", () => {
    expect(
      computeCostUsd({
        providerId: "openai",
        model: "gpt-5.4-mini",
        usage: undefined
      })
    ).toBe(0)
  })

  it("computes OpenAI tier costs from per-million prices", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 }
    expect(
      computeCostUsd({
        providerId: "openai",
        model: "gpt-5.4-mini",
        usage
      })
    ).toBeCloseTo(0.25 * 1 + 2.0 * 0.5, 10)
  })

  it("computes Claude tier costs", () => {
    const usage = { inputTokens: 200_000, outputTokens: 100_000 }
    expect(
      computeCostUsd({
        providerId: "claude",
        model: "claude-haiku-4-5",
        usage
      })
    ).toBeCloseTo(0.2 * 1.0 + 0.1 * 5.0, 10)
  })

  it("computes Google Gemini Flash costs", () => {
    const usage = { inputTokens: 4_000_000, outputTokens: 2_000_000 }
    expect(
      computeCostUsd({
        providerId: "google",
        model: "gemini-2.5-flash",
        usage
      })
    ).toBeCloseTo(4 * 0.075 + 2 * 0.3, 10)
  })

  it("treats local Ollama usage as zero dollars", () => {
    expect(
      computeCostUsd({
        providerId: "ollama",
        model: "llama3.3",
        usage: { inputTokens: 9_000_000, outputTokens: 9_000_000 }
      })
    ).toBe(0)
  })

  it("bills only billed input and output token fields (cache breakdown ignored in v1)", () => {
    expect(
      computeCostUsd({
        providerId: "claude",
        model: "claude-sonnet-4-6",
        usage: {
          inputTokens: 100,
          outputTokens: 0,
          cacheReadInputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000
        }
      })
    ).toBeCloseTo((100 / 1_000_000) * 3.0, 12)
  })
})

describe("aiGenerateResponseWithUsage", () => {
  it("omits usage and cost when usage is absent", () => {
    expect(
      aiGenerateResponseWithUsage({
        providerId: "openai",
        model: "gpt-5.4-mini",
        text: "hi",
        usage: undefined
      })
    ).toEqual({
      providerId: "openai",
      model: "gpt-5.4-mini",
      text: "hi"
    })
  })

  it("includes usage and costUsd when usage is present", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 }
    expect(
      aiGenerateResponseWithUsage({
        providerId: "openai",
        model: "gpt-5-nano",
        text: "out",
        usage
      })
    ).toEqual({
      providerId: "openai",
      model: "gpt-5-nano",
      text: "out",
      usage,
      costUsd: 0.05
    })
  })
})
