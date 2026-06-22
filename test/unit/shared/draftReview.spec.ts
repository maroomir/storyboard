import { describe, expect, it } from "vitest"

import {
  buildRevisionInstructions,
  coerceCritiqueIssues,
  countBlockingIssues,
  type ContinuityIssueLike,
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
  it("Q1: counts only high-severity continuity issues as blocking", () => {
    const continuity = [
      { original: "x", reason: "canon 모순", severity: "high" as const },
      { original: "y", reason: "사소한 모순", severity: "low" as const },
      { original: "z", reason: "또 다른 사소함", severity: "low" as const }
    ]

    expect(countBlockingIssues(continuity, [])).toBe(1)
  })

  it("Q2: is zero when every continuity issue is low severity", () => {
    const continuity = [
      { original: "x", reason: "사소함", severity: "low" as const },
      { original: "y", reason: "사소함", severity: "low" as const }
    ]

    expect(countBlockingIssues(continuity, [])).toBe(0)
  })

  it("Q3: sums high continuity and high critique issues", () => {
    const continuity = [
      { original: "x", reason: "canon 모순", severity: "high" as const },
      { original: "y", reason: "또 다른 모순", severity: "high" as const }
    ]
    const mixedCritique: DraftCritiqueIssue[] = [
      { category: "voice", severity: "high", comment: "a" },
      { category: "repetition", severity: "low", comment: "b" }
    ]

    expect(countBlockingIssues(continuity, mixedCritique)).toBe(3)
  })

  it("Q11: counts a legacy continuity issue defaulted to high as blocking", () => {
    const legacyDefaultedToHigh: ContinuityIssueLike = {
      original: "x",
      reason: "canon 모순",
      severity: "high"
    }

    expect(countBlockingIssues([legacyDefaultedToHigh], [])).toBe(1)
  })

  it("is zero when there are no continuity and no high critique issues", () => {
    expect(countBlockingIssues([], [{ category: "purpose", severity: "low", comment: "c" }])).toBe(0)
  })
})

describe("buildRevisionInstructions", () => {
  it("turns continuity and critique issues into instruction lines", () => {
    const instructions = buildRevisionInstructions(
      [{ original: "녹색 눈", reason: "canon은 파란 눈", severity: "high" }],
      [{ category: "voice", severity: "high", excerpt: "안녕하세요", comment: "반말로 바꾸기" }]
    )

    expect(instructions).toEqual([
      '설정 모순: "녹색 눈" — canon은 파란 눈',
      '캐릭터 보이스 ("안녕하세요"): 반말로 바꾸기'
    ])
  })

  it("Q15: emits a line for every continuity issue regardless of severity", () => {
    const instructions = buildRevisionInstructions(
      [
        { original: "녹색 눈", reason: "canon은 파란 눈", severity: "high" },
        { original: "왼손잡이", reason: "canon은 오른손잡이", severity: "low" }
      ],
      []
    )

    expect(instructions).toHaveLength(2)
    expect(instructions).toEqual([
      '설정 모순: "녹색 눈" — canon은 파란 눈',
      '설정 모순: "왼손잡이" — canon은 오른손잡이'
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
