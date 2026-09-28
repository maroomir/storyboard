import { describe, expect, it } from "vitest"

import { SceneCoveragePrompt } from "@storyboard/story-ai"

describe("SceneCoveragePrompt golden", () => {
  const beats = ["하나가 문을 연다", "경비가 소리친다", "하나가 달아난다"]
  const draft = "하나는 문을 열었다. 경비가 소리쳤다."

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(SceneCoveragePrompt.build(beats, draft, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders no beats for the %s variant", (variant) => {
    expect(SceneCoveragePrompt.build([], "", variant)).toMatchSnapshot()
  })
})
