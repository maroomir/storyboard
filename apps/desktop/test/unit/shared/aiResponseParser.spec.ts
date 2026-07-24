import { describe, expect, it } from "vitest"

import { detectCharactersFromDialogue, parseBulletList, parseCharacterTraitSections, parseJsonArray, parseJsonNestedArray, parseJsonObject, parseMBTI } from '@storyboard/story-ai';

describe("aiResponseParser", () => {
  it("extracts JSON arrays and objects embedded in prose", () => {
    expect(parseJsonArray('응답: [{"name":"엘리아"}] 입니다.')).toEqual([{ name: "엘리아" }])
    expect(parseJsonObject('```json\n{"country":"한국"}\n```')).toEqual({ country: "한국" })
  })

  it("extracts nested duplicate groups with at least two items", () => {
    expect(parseJsonNestedArray('결과: [["엘리아", "엘리"], ["단독"]]')).toEqual([["엘리아", "엘리"]])
  })

  it("parses bullet lists, MBTI, trait sections, and dialogue speakers", () => {
    const traitResponse = `[엘리아]\n- 용감하게 말함\n[지훈]\n- 신중하게 관찰함`

    expect(parseBulletList("- 첫 번째\n- 두 번째")).toEqual(["첫 번째", "두 번째"])
    expect(parseMBTI("분석 결과: ENFP 유형입니다.")).toBe("ENFP")
    expect(parseCharacterTraitSections(traitResponse, ["엘리아", "지훈"])).toEqual({
      엘리아: ["용감하게 말함"],
      지훈: ["신중하게 관찰함"]
    })
    expect(detectCharactersFromDialogue('"엘리아": 안녕\n지훈: 반가워')).toEqual(["엘리아", "지훈"])
  })
})
