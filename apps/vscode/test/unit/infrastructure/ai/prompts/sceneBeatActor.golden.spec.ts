import { describe, expect, it } from "vitest"

import { SceneBeatActorPrompt, coerceBeatProposal, type SceneBeatActorInput } from "@storyboard/story-ai"

describe("SceneBeatActorPrompt golden", () => {
  const full: SceneBeatActorInput = {
    character: {
      name: "하나",
      persona: "말투: 짧고 단호함",
      catchphrases: ["뭐 별거는 아닌데"],
      knowledge: ["준이 편지를 받았다"],
      speechToOthers: ["준에게: 반말"],
      relationChanges: ["준에게 존댓말을 쓰기 시작했다"],
      notes: ["같은 비유를 되풀이하는 것"],
      witnessed: "[대목 1]\n하나가 문을 열었다. “왔어?”"
    },
    beat: { number: 2, text: "준이 편지를 내민다", coordinates: "출연: 하나, 준 / 장소: 창고 / 시각: 밤" },
    nextBeats: [
      { number: 3, text: "하나가 편지를 찢는다" },
      { number: 4, text: "준이 창고를 나간다" }
    ],
    lineMaxChars: 80,
    lineMaxSentences: 2,
    overlongLines: ['선택지 1: "아주 긴 대사" (120자)']
  }
  const bare: SceneBeatActorInput = {
    character: { name: "준", persona: "" },
    beat: { number: 1, text: "준이 들어온다" },
    nextBeats: [],
    lineMaxChars: 80,
    lineMaxSentences: 2
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneBeatActorPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneBeatActorPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("reads a proposal and drops options with neither action nor lines", () => {
    expect(
      coerceBeatProposal({
        inner: " 속마음 ",
        options: [
          { strategy: "밀기", action: "다가선다", lines: ["가자.", ""] },
          { strategy: "빈", action: "", lines: [] },
          "junk"
        ]
      })
    ).toEqual({
      inner: "속마음",
      options: [{ strategy: "밀기", action: "다가선다", lines: ["가자."] }]
    })
    expect(coerceBeatProposal({ options: [] })).toBeUndefined()
    expect(coerceBeatProposal(null)).toBeUndefined()
  })
})
