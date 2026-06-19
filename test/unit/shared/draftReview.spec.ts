import { describe, expect, it } from "vitest"

import {
  buildRevisionInstructions,
  coerceCritiqueIssues,
  countBlockingIssues,
  type DraftCritiqueIssue
} from "@/shared/draftReview"

describe("coerceCritiqueIssues", () => {
  it("parses a JSON array of valid issues", () => {
    const issues = coerceCritiqueIssues(
      '[{"category":"voice","severity":"high","excerpt":"안녕","comment":"엘리아의 말투가 어긋남"}]'
    )

    expect(issues).toEqual([
      { category: "voice", severity: "high", excerpt: "안녕", comment: "엘리아의 말투가 어긋남" }
    ])
  })

  it("defaults severity to low and drops invalid categories", () => {
    const issues = coerceCritiqueIssues(
      '[{"category":"purpose","comment":"목적 불명확"},{"category":"typo","severity":"high","comment":"x"}]'
    )

    expect(issues).toEqual([{ category: "purpose", severity: "low", comment: "목적 불명확" }])
  })

  it("returns an empty array when there is no JSON array", () => {
    expect(coerceCritiqueIssues("문제 없음")).toEqual([])
  })

  it("skips entries without a comment", () => {
    expect(coerceCritiqueIssues('[{"category":"repetition","severity":"low"}]')).toEqual([])
  })
})

describe("countBlockingIssues", () => {
  const critique: DraftCritiqueIssue[] = [
    { category: "voice", severity: "high", comment: "a" },
    { category: "repetition", severity: "low", comment: "b" }
  ]

  it("counts every continuity issue plus only high-severity critique", () => {
    const continuity = [
      { original: "x", reason: "canon 모순" },
      { original: "y", reason: "다른 모순" }
    ]

    expect(countBlockingIssues(continuity, critique)).toBe(3)
  })

  it("is zero when there are no continuity and no high critique issues", () => {
    expect(countBlockingIssues([], [{ category: "purpose", severity: "low", comment: "c" }])).toBe(0)
  })
})

describe("buildRevisionInstructions", () => {
  it("turns continuity and critique issues into instruction lines", () => {
    const instructions = buildRevisionInstructions(
      [{ original: "녹색 눈", reason: "canon은 파란 눈" }],
      [{ category: "voice", severity: "high", excerpt: "안녕하세요", comment: "반말로 바꾸기" }]
    )

    expect(instructions).toEqual([
      '설정 모순: "녹색 눈" — canon은 파란 눈',
      '캐릭터 보이스 ("안녕하세요"): 반말로 바꾸기'
    ])
  })

  it("omits the excerpt fragment when absent", () => {
    const instructions = buildRevisionInstructions(
      [],
      [{ category: "purpose", severity: "low", comment: "장면 목적을 분명히" }]
    )

    expect(instructions).toEqual(["장면 목적: 장면 목적을 분명히"])
  })
})
