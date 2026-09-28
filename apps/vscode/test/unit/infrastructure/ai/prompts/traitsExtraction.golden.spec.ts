import { describe, expect, it } from "vitest"

import { TraitsExtractionPrompt } from "@storyboard/story-ai"

describe("TraitsExtractionPrompt golden", () => {
  const script = "엘리아: 괜찮아요.\n엘리아가 붕대를 감았다."

  it.each(["generic", "xs", "rich"] as const)("renders the aliases and the script for the %s variant", (variant) => {
    expect(TraitsExtractionPrompt.build(script, "엘리아", ["엘", "의사 선생"], variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves the alias line out for the %s variant", (variant) => {
    expect(TraitsExtractionPrompt.build(script, "엘리아", undefined, variant)).toMatchSnapshot()
    expect(TraitsExtractionPrompt.build(script, "엘리아", [], variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("drops an empty script for the %s variant", (variant) => {
    expect(TraitsExtractionPrompt.build("", "엘리아", ["엘"], variant)).toMatchSnapshot()
    expect(TraitsExtractionPrompt.build("", "엘리아", undefined, variant)).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(TraitsExtractionPrompt.build(script, "준")).toMatchSnapshot()
  })
})
