import { describe, expect, it } from "vitest"

import { BackgroundDescriptionPrompt } from "@storyboard/story-ai"
import { createEmptyBackground, type Background } from "@storyboard/story-model"

describe("BackgroundDescriptionPrompt golden", () => {
  const full: Background = {
    ...createEmptyBackground("harbor", "항구"),
    description: ["낡은 부두", "녹슨 크레인"],
    senses: ["소금기", "갈매기 울음"],
    tags: ["바다", "밤"],
    time: "새벽",
    weather: "안개"
  }
  const bare: Background = createEmptyBackground("room", "방")
  const excerpt = "부두 끝에 낡은 등대가 서 있었다."

  it.each(["generic", "xs", "rich"] as const)("renders every field with an excerpt for the %s variant", (variant) => {
    expect(BackgroundDescriptionPrompt.build(full, variant, excerpt)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("renders a bare card without an excerpt for the %s variant", (variant) => {
    expect(BackgroundDescriptionPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("treats an empty excerpt as missing", () => {
    expect(BackgroundDescriptionPrompt.build(full, "generic", "")).toMatchSnapshot()
  })
})
