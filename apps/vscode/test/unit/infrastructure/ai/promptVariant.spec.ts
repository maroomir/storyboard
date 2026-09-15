import { describe, expect, it } from "vitest"

import { selectPromptVariant } from '@storyboard/story-ai';

describe("selectPromptVariant", () => {
  // 로컬의 qwen·gemma 계열은 이름만으로 압축형이 된다. 상한이 모델인지 프롬프트인지 가르려면 강제해야 한다.
  it("lets a configured override beat the model-name rule", () => {
    expect(
      selectPromptVariant({
        providerId: "ollama",
        taskName: "sceneDraft",
        model: "qwen3:14b",
        override: "rich"
      })
    ).toBe("rich")
    expect(
      selectPromptVariant({ providerId: "ollama", taskName: "sceneDraft", model: "qwen3:14b" })
    ).toBe("xs")
  })

  it("returns xs for compact ollama tasks", () => {
    expect(
      selectPromptVariant({
        providerId: "ollama",
        taskName: "inlineCompletion",
        model: "llama3.3",
        maxTokens: 120
      })
    ).toBe("xs")
  })

  it.each(["openai", "claude", "google", "mock"] as const)(
    "returns generic for %s provider",
    (providerId) => {
      expect(
        selectPromptVariant({
          providerId,
          taskName: "grammarCheck",
          model: undefined,
          maxTokens: 500
        })
      ).toBe("generic")
    }
  )

  it("returns rich for long-form scene tasks", () => {
    expect(
      selectPromptVariant({
        providerId: "claude",
        taskName: "sceneDraft",
        model: "claude-sonnet-4-6",
        maxTokens: 12000
      })
    ).toBe("rich")
  })

  it.each([
    ["claude", "claude-fable-5-1"],
    ["openai", "gpt-6-astra"],
    ["google", "gemini-3.1-pro-preview"]
  ] as const)("returns rich for the top-tier %s model %s", (providerId, model) => {
    expect(
      selectPromptVariant({ providerId, taskName: "grammarCheck", model, maxTokens: 500 })
    ).toBe("rich")
  })
})
