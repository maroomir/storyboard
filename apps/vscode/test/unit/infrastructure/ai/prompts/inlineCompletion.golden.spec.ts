import { describe, expect, it } from "vitest"

import { InlineCompletionPrompt, type InlineCompletionPromptContext } from "@storyboard/story-ai"

describe("InlineCompletionPrompt golden", () => {
  const prefix = "그는 창밖을 봤다.\n비가 내렸다."
  const full: InlineCompletionPromptContext = {
    activeCharacter: "엘리아",
    background: "교실",
    sceneIntent: "첫 만남의 긴장"
  }
  const contexts: readonly InlineCompletionPromptContext[] = [
    {},
    { sceneIntent: "첫 만남의 긴장" },
    { activeCharacter: "엘리아" },
    { background: "교실" },
    { sceneIntent: "첫 만남의 긴장", background: "교실" },
    full,
    { activeCharacter: "", background: "", sceneIntent: "" }
  ]

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(InlineCompletionPrompt.build(prefix, full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("drops each missing context line for the %s variant", (variant) => {
    for (const context of contexts) {
      expect(InlineCompletionPrompt.build(prefix, context, variant)).toMatchSnapshot()
    }
  })

  it.each(["generic", "xs"] as const)("drops an empty prefix for the %s variant", (variant) => {
    for (const context of contexts) {
      expect(InlineCompletionPrompt.build("", context, variant)).toMatchSnapshot()
    }
  })

  it("defaults to the generic variant without context", () => {
    expect(InlineCompletionPrompt.build(prefix)).toMatchSnapshot()
  })
})
