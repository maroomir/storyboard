import { describe, expect, it } from "vitest"

import {
  findBrokenGlyphSpans,
  findRareHangulSyllableSpans,
  type BrokenHangulSpan,
} from "@storyboard/story-model"

function textsOf(spans: readonly BrokenHangulSpan[]): string[] {
  return spans.map((span) => span.text)
}

describe("findRareHangulSyllableSpans", () => {
  it("finds the syllables outside the common 2,350 that broke in generated drafts (#188)", () => {
    const text: string = "성재는 벌써 반쯜 몸을 돌렸다. 길이 길게 느껴졠다. 잔을 부딫치고 이쪻에서 웃었다."

    expect(textsOf(findRareHangulSyllableSpans(text))).toEqual(["쯜", "졠", "딫", "쪻"])
  })

  it("leaves ordinary prose alone", () => {
    expect(findRareHangulSyllableSpans("반쯤 열린 문 너머로 잔이 부딪히는 소리가 났다.")).toEqual([])
  })

  it("allows a rare syllable that the given text already uses, such as a name", () => {
    const text: string = "똠얌을 먹던 뙇이가 웃었다."

    expect(textsOf(findRareHangulSyllableSpans(text))).toEqual(["똠", "뙇"])
    expect(findRareHangulSyllableSpans(text, "인물: 뙇이, 음식: 똠얌")).toEqual([])
  })

  it("points at the spot with an excerpt around the syllable", () => {
    const [span] = findRareHangulSyllableSpans("집으로 돌아가는 길이 평소보다 길게 느껴졠다.")

    expect(span?.excerpt).toContain("느껴졠다")
  })
})

describe("findBrokenGlyphSpans", () => {
  it("joins lone jamo and rare syllables in text order", () => {
    expect(textsOf(findBrokenGlyphSpans("반쯜 열고 ㅈ 권을 집었다"))).toEqual(["쯜", "ㅈ"])
  })
})
