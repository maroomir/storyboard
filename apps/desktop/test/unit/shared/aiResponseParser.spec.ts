import { describe, expect, it } from "vitest"

import { detectCharactersFromDialogue, parseBulletList, parseCharacterTraitSections, parseJsonArray, parseJsonNestedArray, parseJsonObject, parseMBTI } from '@storyboard/story-ai';

describe("aiResponseParser", () => {
  it("extracts JSON arrays and objects embedded in prose", () => {
    expect(parseJsonArray('응답: [{"name":"엘리아"}] 입니다.')).toEqual([{ name: "엘리아" }])
    expect(parseJsonObject('```json\n{"country":"한국"}\n```')).toEqual({ country: "한국" })
  })

  it("recovers an object when the model appends a stray closing brace", () => {
    expect(parseJsonObject('{"kind":"say","message":"네"}}')).toEqual({
      kind: "say",
      message: "네"
    })
  })

  it("recovers an object when prose after it carries braces", () => {
    expect(parseJsonObject('{"kind":"say","message":"네"}\n설명: { 참고 }')).toEqual({
      kind: "say",
      message: "네"
    })
  })

  it("keeps braces that live inside strings intact", () => {
    expect(parseJsonObject('{"message":"괄호 } 포함","ok":true}]')).toEqual({
      message: "괄호 } 포함",
      ok: true
    })
  })

  it("skips a leading brace that is not the object", () => {
    expect(parseJsonObject('참고 { 메모 }\n{"kind":"say","message":"네"}')).toEqual({
      kind: "say",
      message: "네"
    })
  })

  it("returns nothing when no balanced object exists", () => {
    expect(parseJsonObject('{"kind":"say"')).toBeNull()
    expect(parseJsonObject("설명만 있습니다")).toBeNull()
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
