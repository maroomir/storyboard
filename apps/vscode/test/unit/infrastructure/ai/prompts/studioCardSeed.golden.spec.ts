import { describe, expect, it } from "vitest"

import { StudioCardSeedPrompt } from "@storyboard/story-ai"

describe("StudioCardSeedPrompt golden", () => {
  it("renders the description", () => {
    expect(StudioCardSeedPrompt.build("정난정은 조선 중기의 여인이다.\n권세를 쥐었다.")).toMatchSnapshot()
  })

  it("renders an empty description", () => {
    expect(StudioCardSeedPrompt.build("")).toMatchSnapshot()
  })
})
