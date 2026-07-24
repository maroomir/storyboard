import { describe, expect, it } from "vitest"

import type { Background } from "@/domain/Background"
import { BackgroundDescriptionPrompt } from "@/infrastructure/ai/prompts/backgroundDescription"

const baseBackground: Background = {
  type: "location",
  id: "school",
  name: "학교 정문",
  locationKind: "place",
  description: [],
  characterIds: [],
  tags: []
}

describe("BackgroundDescriptionPrompt", () => {
  it("includes time, weather, and senses in the user block", () => {
    const artifact = BackgroundDescriptionPrompt.build({
      ...baseBackground,
      time: "아침",
      weather: "맑음",
      senses: ["멀리서 울리는 종소리", "갓 자른 잔디 냄새"]
    })

    expect(artifact.user).toContain("시간: 아침")
    expect(artifact.user).toContain("날씨: 맑음")
    expect(artifact.user).toContain("감각: 멀리서 울리는 종소리\n갓 자른 잔디 냄새")
  })

  it("omits the atmosphere lines when those fields are unset", () => {
    const artifact = BackgroundDescriptionPrompt.build(baseBackground)

    expect(artifact.user).not.toContain("시간:")
    expect(artifact.user).not.toContain("날씨:")
    expect(artifact.user).not.toContain("감각:")
  })
})
