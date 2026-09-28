import { describe, expect, it } from "vitest"

import { DraftExpansionPrompt, type DraftExpansionPromptContext } from "@storyboard/story-ai"

describe("DraftExpansionPrompt golden", () => {
  const selection = "그는 문을 열었다.\n바람이 불었다."
  const full: DraftExpansionPromptContext = { activeCharacter: "엘리아", background: "교실" }
  const contexts: readonly DraftExpansionPromptContext[] = [
    {},
    { activeCharacter: "엘리아" },
    { background: "교실" },
    full,
    { activeCharacter: "", background: "" }
  ]

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(DraftExpansionPrompt.build(selection, full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("drops each missing context line for the %s variant", (variant) => {
    for (const context of contexts) {
      expect(DraftExpansionPrompt.build(selection, context, variant)).toMatchSnapshot()
    }
  })

  it.each(["generic", "xs"] as const)("drops an empty selection for the %s variant", (variant) => {
    for (const context of contexts) {
      expect(DraftExpansionPrompt.build("", context, variant)).toMatchSnapshot()
    }
  })

  it("defaults to the generic variant without context", () => {
    expect(DraftExpansionPrompt.build(selection)).toMatchSnapshot()
  })
})
