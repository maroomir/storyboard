import { describe, expect, it } from "vitest"

import { SceneBeatsPrompt, type SceneBeatsPromptInput } from "@storyboard/story-ai"

describe("SceneBeatsPrompt golden", () => {
  const full: SceneBeatsPromptInput = {
    sceneBody: "목적: 탈출\n갈등: 경비",
    summary: "  하나가 문을 열고 달아난다.  ",
    grounding: ["[확정 사실]", "- 문은 잠겨 있다"],
    characterNames: ["하나", "준"],
    beatCount: 6
  }
  const bare: SceneBeatsPromptInput = { sceneBody: "목적: 대화", grounding: [], characterNames: [], beatCount: 3 }
  const blankSummary: SceneBeatsPromptInput = { ...bare, summary: "   " }
  const emptyBody: SceneBeatsPromptInput = { ...bare, sceneBody: "" }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneBeatsPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneBeatsPrompt.build(bare, variant)).toMatchSnapshot()
    expect(SceneBeatsPrompt.build(blankSummary, variant)).toMatchSnapshot()
    expect(SceneBeatsPrompt.build(emptyBody, variant)).toMatchSnapshot()
    expect(SceneBeatsPrompt.build({ ...emptyBody, summary: "요약만" }, variant)).toMatchSnapshot()
  })
})
