import { describe, expect, it } from "vitest"

import { CardCandidateVerificationPrompt } from "@storyboard/story-ai"

describe("CardCandidateVerificationPrompt golden", () => {
  const body = "엘리아는 항구 병원의 의사다."
  const statements = ["엘리아는 의사다", "엘리아는 서른 살이다"]

  it.each(["generic", "xs", "rich"] as const)("renders numbered statements for the %s variant", (variant) => {
    expect(CardCandidateVerificationPrompt.build(body, "엘리아", statements, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders an empty statement list for the %s variant", (variant) => {
    expect(CardCandidateVerificationPrompt.build(body, "엘리아", [], variant)).toMatchSnapshot()
  })
})
