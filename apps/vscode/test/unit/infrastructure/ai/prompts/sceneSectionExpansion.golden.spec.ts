import { describe, expect, it } from "vitest"

import { SceneSectionExpansionPrompt, type SceneSectionExpansionInput } from "@storyboard/story-ai"

describe("SceneSectionExpansionPrompt golden", () => {
  const full: SceneSectionExpansionInput = {
    skeleton: "하나가 문을 연다.\n---\n준이 들어온다.",
    section: "준이 들어온다.",
    previousSection: "하나는 문고리를 잡았다.",
    targetLength: 1500,
    retryReasons: ["대사 반복", "분량 부족"],
    style: {
      narration: { person: "first", knowledge: "witnessed", tense: "present", focal: "하나", voice: ["건조함"] },
      genre: "스릴러",
      styleConstraints: ["짧은 문장"],
      prohibitions: ["욕설"],
      relationStage: "경계",
      targetWordCount: 4000,
      craftContract: { banTelling: false, motifRepeatLimit: 2, stockGestureBlacklist: [] }
    }
  }
  const bare: SceneSectionExpansionInput = { skeleton: "뼈대", section: "구간", targetLength: 800 }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneSectionExpansionPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneSectionExpansionPrompt.build(bare, variant)).toMatchSnapshot()
    expect(
      SceneSectionExpansionPrompt.build(
        { ...bare, previousSection: "", retryReasons: [], style: { targetWordCount: 3000 } },
        variant
      )
    ).toMatchSnapshot()
  })
})
