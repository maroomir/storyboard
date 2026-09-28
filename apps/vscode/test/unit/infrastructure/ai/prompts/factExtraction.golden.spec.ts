import { describe, expect, it } from "vitest"

import { FactExtractionPrompt } from "@storyboard/story-ai"

describe("FactExtractionPrompt golden", () => {
  const body = "엘리아는 녹색 눈을 가졌다.\n그녀는 스물다섯 살이다."

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(FactExtractionPrompt.build(body, "엘리아", variant)).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(FactExtractionPrompt.build(body, "준")).toMatchSnapshot()
  })

  it("keeps an empty body", () => {
    expect(FactExtractionPrompt.build("", "엘리아", "generic")).toMatchSnapshot()
    expect(FactExtractionPrompt.build("", "엘리아", "xs")).toMatchSnapshot()
  })
})
