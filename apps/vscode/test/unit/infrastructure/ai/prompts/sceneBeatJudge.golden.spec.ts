import { describe, expect, it } from "vitest"

import {
  SceneBeatJudgePrompt,
  coerceBeatVerdict,
  parseBeatJsonObject,
  type SceneBeatJudgeInput
} from "@storyboard/story-ai"

describe("SceneBeatJudgePrompt golden", () => {
  const full: SceneBeatJudgeInput = {
    characters: [
      {
        name: "하나",
        persona: "말투: 짧고 단호함",
        catchphrases: ["뭐 별거는 아닌데"],
        knowledge: ["준이 편지를 받았다"],
        speechToOthers: ["준에게: 반말"],
        witnessed: "[대목 1]\n하나가 문을 열었다."
      },
      { name: "준", persona: "" }
    ],
    beat: { number: 2, text: "준이 편지를 내민다", coordinates: "출연: 하나, 준 / 장소: 창고 / 시각: 밤" },
    nextBeats: [{ number: 3, text: "하나가 편지를 찢는다" }],
    previousPassages: "[대목 1]\n하나가 문을 열었다.",
    passage: "준이 편지를 내밀었다. 하나는 받지 않았다.\n\n“안 받아.”"
  }
  const bare: SceneBeatJudgeInput = {
    characters: [{ name: "준", persona: "" }],
    beat: { number: 1, text: "준이 들어온다" },
    nextBeats: [],
    passage: "준이 들어왔다."
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneBeatJudgePrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneBeatJudgePrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("keeps integer scores in range and reads the beat flags", () => {
    expect(
      coerceBeatVerdict({
        scores: [
          { name: "하나", score: 4, reason: "단호함", avoid: "" },
          { name: "준", score: "2", reason: "", avoid: "같은 비유" },
          { name: "", score: 5 },
          { name: "셋", score: 7 }
        ],
        beatCovered: false,
        beatMissing: "편지를 내밀지 않음"
      })
    ).toEqual({
      scores: [
        { name: "하나", score: 4, reason: "단호함", avoid: "" },
        { name: "준", score: 2, reason: "", avoid: "같은 비유" }
      ],
      isBeatCovered: false,
      beatMissing: "편지를 내밀지 않음",
      earlyMaterial: "",
      repeats: ""
    })
    expect(coerceBeatVerdict({ beatCovered: true })).toBeUndefined()
  })

  it("repairs a stray comma-quote before the closing brace", () => {
    expect(parseBeatJsonObject('{"scores":[{"name":"하나","score":4,"reason":"r","avoid":"말 것","}],"beatCovered":true}')).toEqual({
      scores: [{ name: "하나", score: 4, reason: "r", avoid: "말 것" }],
      beatCovered: true
    })
  })
})
