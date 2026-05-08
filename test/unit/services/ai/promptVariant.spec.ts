import { describe, expect, it } from "vitest"

import { selectPromptVariant } from "@/services/ai/prompts/variant"

describe("selectPromptVariant", () => {
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
})
