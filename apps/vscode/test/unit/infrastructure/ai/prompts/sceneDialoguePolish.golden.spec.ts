import { describe, expect, it } from "vitest"

import { SceneDialoguePolishPrompt, type SceneDialoguePolishInput } from "@storyboard/story-ai"

describe("SceneDialoguePolishPrompt golden", () => {
  const full: SceneDialoguePolishInput = {
    numberedSkeleton: "하나가 말했다. ⟨1⟩“가자.”\n---\n준이 고개를 저었다. ⟨2⟩“싫어.”",
    character: {
      name: "준",
      persona: "말투: 느릿함",
      catchphrases: ["뭐 별거는 아닌데"],
      samples: ["“빨리 와.”", "“됐어.”"],
      knowledge: ["하나가 편지를 받았다"],
      speechToOthers: ["하나에게: 반말"]
    },
    otherCharacters: ["하나", "민"],
    style: {
      narration: { tense: "present", focal: "하나" },
      genre: "무협",
      styleConstraints: ["짧은 문장"],
      prohibitions: ["욕설"],
      relationStage: "경계"
    }
  }
  const bare: SceneDialoguePolishInput = {
    numberedSkeleton: "빈 장면",
    character: { name: "하나", persona: "" },
    otherCharacters: []
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneDialoguePolishPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneDialoguePolishPrompt.build(bare, variant)).toMatchSnapshot()
    expect(
      SceneDialoguePolishPrompt.build({ ...bare, character: { name: "하나", persona: "말투: 단호" }, style: {} }, variant)
    ).toMatchSnapshot()
  })
})
