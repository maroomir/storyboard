import { describe, expect, it } from "vitest"

import { ContinuityCheckPrompt } from "@storyboard/story-ai"

describe("ContinuityCheckPrompt golden", () => {
  const body = "<!-- scene: 001 -->\n엘리아는 변호사였다."
  const facts = ["엘리아는 의사다", "도시는 항구다"]

  it.each(["generic", "xs", "rich"] as const)("renders scene markers for the %s variant", (variant) => {
    expect(ContinuityCheckPrompt.build(body, facts, variant, true)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("leaves the marker line out for the %s variant", (variant) => {
    expect(ContinuityCheckPrompt.build(body, facts, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders empty facts for the %s variant", (variant) => {
    expect(ContinuityCheckPrompt.build(body, [], variant)).toMatchSnapshot()
  })
})
