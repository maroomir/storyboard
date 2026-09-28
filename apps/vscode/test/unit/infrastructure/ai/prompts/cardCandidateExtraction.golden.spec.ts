import { describe, expect, it } from "vitest"

import { CardCandidateExtractionPrompt } from "@storyboard/story-ai"

describe("CardCandidateExtractionPrompt golden", () => {
  const body = "엘리아가 준에게 존댓말로 말했다."
  const aliases = ["의사", "  ", "엘리"]

  it.each(["generic", "xs", "rich"] as const)("renders aliases for the %s variant", (variant) => {
    expect(CardCandidateExtractionPrompt.build(body, "엘리아", aliases, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("leaves the alias hint out for the %s variant", (variant) => {
    expect(CardCandidateExtractionPrompt.build(body, "엘리아", undefined, variant)).toMatchSnapshot()
  })

  it("treats blank-only aliases as none", () => {
    expect(CardCandidateExtractionPrompt.build(body, "엘리아", [" ", ""])).toMatchSnapshot()
    expect(CardCandidateExtractionPrompt.build(body, "엘리아", [" "], "xs")).toMatchSnapshot()
  })
})
