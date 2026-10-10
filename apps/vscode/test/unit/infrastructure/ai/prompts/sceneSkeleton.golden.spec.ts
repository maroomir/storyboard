import { describe, expect, it } from "vitest"

import { SceneSkeletonPrompt, type SceneSkeletonInput } from "@storyboard/story-ai"
import { createEmptyBackground } from "@storyboard/story-model"

describe("SceneSkeletonPrompt golden", () => {
  const emptyBackground = createEmptyBackground("scene-default", "미정")
  const full: SceneSkeletonInput = {
    narrativeSource: "1. 하나가 문을 연다\n2. 준이 들어온다",
    design: "목적: 재회\n갈등: 오해",
    personas: new Map([
      ["하나", "말투: 짧고 단호함"],
      ["준", ""]
    ]),
    catchphrases: new Map([["하나", ["뭐 별거는 아닌데"]]]),
    characterKnowledge: new Map([["준", ["하나가 편지를 받았다"]]]),
    background: { ...emptyBackground, description: ["비 내리는 부두", "낡은 창고"] },
    previousContext: "둘은 어제 다퉜다.",
    endState: "준이 문을 닫고 나간다.",
    grounding: { incident: "편지가 도착했다", place: "부두 창고" },
    style: {
      narration: { person: "first", knowledge: "witnessed", tense: "present", focal: "하나", voice: ["건조한 단문"] },
      genre: "로맨스",
      relationStage: "냉전",
      craftContract: { banTelling: false, actionClarity: true }
    },
    targetLength: 2500,
    retryReasons: ["인물 재등장", "종료 지점 초과"]
  }
  const bare: SceneSkeletonInput = { narrativeSource: "사건 하나", personas: new Map(), background: emptyBackground }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneSkeletonPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("asks for breaks only at the planned segments for the %s variant", (variant) => {
    const planned = SceneSkeletonPrompt.build(
      { ...bare, narrativeSource: "⟪대목 1⟫\n사건 하나\n\n⟪대목 2⟫\n사건 둘", plannedBreaks: true },
      variant
    )

    expect(planned).toMatchSnapshot()
    expect(JSON.stringify(planned)).not.toContain("⟪시각:")
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneSkeletonPrompt.build(bare, variant)).toMatchSnapshot()
    expect(
      SceneSkeletonPrompt.build(
        { ...bare, design: "", previousContext: "", endState: "", targetLength: 0, retryReasons: [], grounding: {} },
        variant
      )
    ).toMatchSnapshot()
  })
})
