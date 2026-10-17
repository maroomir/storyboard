import { describe, expect, it } from "vitest"

import { SceneBeatArbiterPrompt, splitBeatPassage, type SceneBeatArbiterInput } from "@storyboard/story-ai"

describe("SceneBeatArbiterPrompt golden", () => {
  const full: SceneBeatArbiterInput = {
    beat: { number: 2, text: "준이 편지를 내민다", coordinates: "출연: 하나, 준 / 장소: 창고 / 시각: 밤" },
    nextBeats: [{ number: 3, text: "하나가 편지를 찢는다" }],
    proposals: [
      {
        name: "하나",
        proposal: {
          inner: "받기 싫다.",
          options: [{ strategy: "거절", action: "손을 내리지 않는다", lines: ["안 받아."] }]
        }
      },
      { name: "준", proposal: undefined }
    ],
    priorPassages: "[대목 1]\n하나가 문을 열었다. “왔어?”",
    grounding: { incident: "편지가 도착했다", place: "부두 창고" },
    design: "[목적]\n재회",
    previousContext: "[설정 메모]\n- 둘은 어제 다퉜다.",
    innerCharacter: "하나",
    catchphraseLimit: 1,
    endState: "준이 문을 닫고 나간다.",
    retryReasons: ["하나: 모르는 사실을 말함"],
    style: {
      narration: { person: "first", knowledge: "witnessed", tense: "past", focal: "하나" },
      genre: "로맨스"
    }
  }
  const bare: SceneBeatArbiterInput = {
    beat: { number: 1, text: "준이 들어온다" },
    nextBeats: [],
    proposals: [],
    catchphraseLimit: 1
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneBeatArbiterPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneBeatArbiterPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("splits the choice line off the passage, and keeps a response without one whole", () => {
    expect(splitBeatPassage("[선택: 하나=1]\n하나가 손을 내렸다.\n\n“안 받아.”")).toEqual({
      choice: "[선택: 하나=1]",
      passage: "하나가 손을 내렸다.\n\n“안 받아.”"
    })
    expect(splitBeatPassage("하나가 손을 내렸다.")).toEqual({ choice: "", passage: "하나가 손을 내렸다." })
  })
})
