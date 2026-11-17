import { describe, expect, it } from "vitest"

import { applyProofreadEdits, splitIntoProofreadChunks, type ProofreadLimits } from "@storyboard/story-engine"
import { coerceProofreadEdits } from "@storyboard/story-model"

const limits: ProofreadLimits = { maxEditLength: 20, maxEditDistance: 3 }

describe("applyProofreadEdits", () => {
  it("fixes broken syllables and misspellings everywhere they appear (#188)", () => {
    const text: string = "반쯜 열린 문. 해가 뉘엿뉘엇 졌다. 다시 반쯜 열었다."

    const result = applyProofreadEdits(
      text,
      [
        { before: "반쯜", after: "반쯤" },
        { before: "뉘엿뉘엇", after: "뉘엿뉘엿" }
      ],
      { allowedText: "", limits }
    )

    expect(result.text).toBe("반쯤 열린 문. 해가 뉘엿뉘엿 졌다. 다시 반쯤 열었다.")
    expect(result.appliedEdits).toHaveLength(2)
  })

  it("refuses edits that rewrite instead of correcting", () => {
    const text: string = "그는 조용히 웃었다."

    const result = applyProofreadEdits(
      text,
      [
        { before: "조용히 웃었다", after: "크게 소리 내어 울었다" },
        { before: "없는 구절", after: "없는 구절이" },
        { before: "그는", after: "그는" },
        { before: "웃었다.", after: "웃었다.\n\n" }
      ],
      { allowedText: "", limits }
    )

    expect(result.text).toBe(text)
    expect(result.appliedEdits).toEqual([])
  })

  it("refuses an edit whose replacement is itself broken", () => {
    const result = applyProofreadEdits("반쯜 열린 문", [{ before: "반쯜", after: "반쯘" }], { allowedText: "", limits })

    expect(result.text).toBe("반쯜 열린 문")
  })

  it("refuses a span longer than the edit limit", () => {
    const longSpan: string = "가나다라마바사아자차카타파하가나다라마바사"

    const result = applyProofreadEdits(longSpan, [{ before: longSpan, after: `${longSpan.slice(1)}` }], { allowedText: "", limits })

    expect(result.appliedEdits).toEqual([])
  })
})

describe("splitIntoProofreadChunks", () => {
  it("cuts at paragraph breaks and joins back to the same text", () => {
    const paragraphs: string[] = Array.from({ length: 12 }, (_, index) => `문단 ${index} `.repeat(40))
    const text: string = paragraphs.join("\n\n")

    const chunks: string[] = splitIntoProofreadChunks(text, 1000)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join("")).toBe(text)
    expect(chunks.slice(0, -1).every((chunk) => chunk.endsWith("\n\n"))).toBe(true)
  })

  it("keeps a short text in one chunk", () => {
    expect(splitIntoProofreadChunks("짧은 본문", 1000)).toEqual(["짧은 본문"])
  })
})

describe("coerceProofreadEdits", () => {
  it("keeps well-formed edits and drops the rest", () => {
    expect(
      coerceProofreadEdits('결과: [{"before":"반쯜","after":"반쯤"},{"before":""},{"after":"x"}]')
    ).toEqual([{ before: "반쯜", after: "반쯤" }])
  })

  it("reads an answer with no JSON as no edits", () => {
    expect(coerceProofreadEdits("고칠 곳이 없습니다")).toEqual([])
  })
})
