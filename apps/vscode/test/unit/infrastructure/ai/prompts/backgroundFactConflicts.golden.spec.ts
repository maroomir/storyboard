import { describe, expect, it } from "vitest"

import { BackgroundFactConflictsPrompt } from "@storyboard/story-ai"
import { createEmptyBackground, type Background } from "@storyboard/story-model"

describe("BackgroundFactConflictsPrompt golden", () => {
  const condo: Background = {
    ...createEmptyBackground("condo", "해외 콘도"),
    description: ["손님은 거실 소파에서 잔다", "손님에게 자기 방이 있다"],
    senses: ["에어컨 바람 냄새"],
    tags: ["세부"],
    time: "오후",
    weather: "맑음"
  }

  it.each(["generic", "xs", "rich"] as const)("lists the time, description and senses for the %s variant", (variant) => {
    expect(BackgroundFactConflictsPrompt.build(condo, variant)).toMatchSnapshot()
  })
})
