import { describe, expect, it } from "vitest"

import { CardRecommendationPrompt } from "@storyboard/story-ai"

describe("CardRecommendationPrompt golden", () => {
  const body = "엘리아와 준이 항구 등대 아래서 만났다."
  const knownNames = ["엘리아", "  ", " 항구 "]

  it.each([
    ["character", "generic"],
    ["character", "xs"],
    ["character", "rich"],
    ["background", "generic"],
    ["background", "xs"],
    ["background", "rich"]
  ] as const)("renders known names for %s in the %s variant", (category, variant) => {
    expect(CardRecommendationPrompt.build(body, category, knownNames, variant)).toMatchSnapshot()
  })

  it.each([
    ["character", "generic"],
    ["character", "xs"],
    ["background", "generic"],
    ["background", "xs"]
  ] as const)("leaves the exclusion out for %s in the %s variant", (category, variant) => {
    expect(CardRecommendationPrompt.build(body, category, [" "], variant)).toMatchSnapshot()
  })
})
