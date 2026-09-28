import { describe, expect, it } from "vitest"

import { SituationExtractionPrompt } from "@storyboard/story-ai"

describe("SituationExtractionPrompt golden", () => {
  const input = "엘리아가 항구에 도착했다.\n준이 그녀를 맞았다."

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(SituationExtractionPrompt.build(input, variant)).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(SituationExtractionPrompt.build(input)).toMatchSnapshot()
  })
})
