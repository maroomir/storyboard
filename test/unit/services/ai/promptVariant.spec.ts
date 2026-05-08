import { describe, expect, it } from "vitest"

import { selectPromptVariant } from "@/services/ai/prompts/variant"

describe("selectPromptVariant", () => {
  it("returns xs for ollama provider", () => {
    expect(selectPromptVariant("ollama")).toBe("xs")
  })

  it.each(["openai", "claude", "google", "mock"] as const)(
    "returns generic for %s provider",
    (providerId) => {
      expect(selectPromptVariant(providerId)).toBe("generic")
    }
  )
})
