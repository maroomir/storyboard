import { describe, expect, it } from "vitest"

import { SceneDialoguePolishPrompt, type SceneDialoguePolishInput } from "@storyboard/story-ai"

describe("SceneDialoguePolishPrompt golden", () => {
  const full: SceneDialoguePolishInput = {
    skeleton: "하나가 말했다. “가자.”\n---\n준이 고개를 저었다.",
    personas: new Map([
      ["하나", "말투: 짧고 단호함\n호칭: 너"],
      ["준", "말투: 느릿함"],
      ["민", ""]
    ]),
    voiceSamples: new Map([
      ["하나", ["“빨리 와.”", "“됐어.”"]],
      ["준", []]
    ]),
    style: {
      narration: { tense: "present", focal: "하나" },
      genre: "무협",
      styleConstraints: ["짧은 문장"],
      prohibitions: ["욕설"],
      relationStage: "경계"
    }
  }
  const bare: SceneDialoguePolishInput = { skeleton: "빈 장면", personas: new Map() }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneDialoguePolishPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneDialoguePolishPrompt.build(bare, variant)).toMatchSnapshot()
    expect(
      SceneDialoguePolishPrompt.build({ ...bare, personas: new Map([["하나", "말투: 단호"]]), style: {} }, variant)
    ).toMatchSnapshot()
  })
})
