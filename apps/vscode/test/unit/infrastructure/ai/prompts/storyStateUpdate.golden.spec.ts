import { describe, expect, it } from "vitest"

import { StoryStateUpdatePrompt, type StoryStateUpdateInput } from "@storyboard/story-ai"

describe("StoryStateUpdatePrompt golden", () => {
  const full: StoryStateUpdateInput = {
    sceneTitle: "3. 항구의 밤",
    draftBody: "엘리아가 항구에 도착했다.\n준이 그녀를 맞았다.",
    previousState: "- facts: 엘리아는 의사다\n- relations: 엘리아와 준은 존댓말"
  }
  const bare: StoryStateUpdateInput = { sceneTitle: "1. 시작", draftBody: "본문만." }
  const emptyPrevious: StoryStateUpdateInput = { ...bare, previousState: "" }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(StoryStateUpdatePrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves the previous state out for the %s variant", (variant) => {
    expect(StoryStateUpdatePrompt.build(bare, variant)).toMatchSnapshot()
    expect(StoryStateUpdatePrompt.build(emptyPrevious, variant)).toMatchSnapshot()
  })
})
