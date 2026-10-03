import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  buildRevisionInstructions,
  coerceCritiqueIssues,
  countBlockingIssues,
  scoreCritique,
  shouldPassRevise,
} from '@storyboard/story-model';
import { toContinuityIssue } from '@storyboard/story-ai';
import type { ContinuityIssueLike, DraftCritiqueIssue } from '@storyboard/story-model';

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

describe("scoreCritique", () => {
  it("QAS-C3-01: returns a perfect score with zero deductions for empty critique", () => {
    expect(scoreCritique([])).toEqual({
      overall: 100,
      perCategory: { voice: 0, purpose: 0, repetition: 0 },
      issueCount: 0
    })
  })

  it("QAS-C3-02: deducts a single high voice issue to overall 88", () => {
    const score = scoreCritique([{ category: "voice", severity: "high", comment: "보이스 어긋남" }])

    expect(score.overall).toBe(88)
    expect(score.perCategory.voice).toBe(12)
  })

  it("QAS-C3-03: a high issue deducts more than a low issue in the same category", () => {
    const high = scoreCritique([{ category: "voice", severity: "high", comment: "a" }])
    const low = scoreCritique([{ category: "voice", severity: "low", comment: "a" }])

    expect(high.overall).toBe(88)
    expect(low.overall).toBe(96)
    expect(high.overall).toBeLessThan(low.overall)
  })

  it("QAS-C3-04: a high purpose issue deducts more than a high repetition issue", () => {
    const purpose = scoreCritique([{ category: "purpose", severity: "high", comment: "a" }])
    const repetition = scoreCritique([{ category: "repetition", severity: "high", comment: "a" }])

    expect(purpose.overall).toBe(85)
    expect(repetition.overall).toBe(92)
    expect(purpose.overall).toBeLessThan(repetition.overall)
  })

  it("QAS-C3-05: clamps overall to 0 (never negative) while reporting un-clamped per-category", () => {
    const tenHighPurpose: DraftCritiqueIssue[] = Array.from({ length: 10 }, () => ({
      category: "purpose",
      severity: "high",
      comment: "목적 실패"
    }))

    const score = scoreCritique(tenHighPurpose)

    expect(score.overall).toBe(0)
    expect(score.overall).toBeGreaterThanOrEqual(0)
    expect(score.perCategory.purpose).toBe(150)
  })

  it("QAS-C3-06: clamps overall to the upper bound, exactly 100 for empty critique", () => {
    const score = scoreCritique([])

    expect(score.overall).toBeLessThanOrEqual(100)
    expect(score.overall).toBe(100)
  })

  it("QAS-C3-07: accounts per category for a mixed issue list (Example C)", () => {
    const score = scoreCritique([
      { category: "purpose", severity: "high", comment: "a" },
      { category: "voice", severity: "low", comment: "b" },
      { category: "repetition", severity: "low", comment: "c" },
      { category: "repetition", severity: "low", comment: "d" }
    ])

    expect(score).toEqual({
      overall: 75,
      perCategory: { voice: 4, purpose: 15, repetition: 6 },
      issueCount: 4
    })
  })

  it("QAS-C3-09: is deterministic across two calls on the same input", () => {
    const input: DraftCritiqueIssue[] = [
      { category: "purpose", severity: "high", comment: "a" },
      { category: "voice", severity: "low", comment: "b" }
    ]

    expect(scoreCritique(input)).toEqual(scoreCritique(input))
  })
})

describe("shouldPassRevise", () => {
  it("QAS-C3-12: does not pass on score when threshold is 0 (inert)", () => {
    expect(shouldPassRevise({ blocking: 1, score: 100, threshold: 0, highContinuityCount: 0 })).toBe(false)
  })

  it("QAS-C3-13: passes early when score meets the threshold and no high continuity", () => {
    expect(shouldPassRevise({ blocking: 1, score: 88, threshold: 85, highContinuityCount: 0 })).toBe(true)
  })

  it("QAS-C3-14: a high continuity issue still gates even at a perfect score", () => {
    expect(shouldPassRevise({ blocking: 2, score: 100, threshold: 85, highContinuityCount: 1 })).toBe(false)
  })

  it("QAS-C3-15: passes when there are no blocking issues regardless of score", () => {
    expect(shouldPassRevise({ blocking: 0, score: 50, threshold: 0, highContinuityCount: 0 })).toBe(true)
  })

  it("QAS-C3-16: passes at the threshold boundary (>=)", () => {
    expect(shouldPassRevise({ blocking: 1, score: 88, threshold: 88, highContinuityCount: 0 })).toBe(true)
  })

  it("QAS-C3-17: does not pass just under the threshold", () => {
    expect(shouldPassRevise({ blocking: 1, score: 88, threshold: 89, highContinuityCount: 0 })).toBe(false)
  })
})

describe("draftReview module purity", () => {
  it("QAS-C3-08: source has no vscode, AI service, or network imports", () => {
    const sourcePath = fileURLToPath(new URL("../../../../../packages/story-model/src/contracts/draftReview.ts", import.meta.url))
    const source = readFileSync(sourcePath, "utf8")

    expect(source.length).toBeGreaterThan(0)
    expect(source).not.toMatch(/from\s+["']vscode["']/)
    expect(source).not.toMatch(/services\/ai/)
    expect(source).not.toMatch(/from\s+["']https?:\/\//)
  })
})

describe("scene stem on review issues", () => {
  it("keeps the scene a critique issue names", () => {
    const issues = coerceCritiqueIssues(
      '[{"category":"voice","severity":"high","comment":"말투 어긋남","sceneStem":"02-meeting"}]'
    )

    expect(issues[0]?.sceneStem).toBe("02-meeting")
  })

  it("leaves the scene undefined when the review names none", () => {
    const issues = coerceCritiqueIssues('[{"category":"voice","severity":"high","comment":"말투"}]')

    expect(issues[0]?.sceneStem).toBeUndefined()
  })

  it("keeps the scene a continuity issue names and ignores a blank one", () => {
    const named = toContinuityIssue({
      start: 0,
      end: 3,
      original: "열여덟",
      reason: "설정은 17세",
      severity: "high",
      sceneStem: " 02-meeting "
    })
    const blank = toContinuityIssue({
      start: 0,
      end: 3,
      original: "열여덟",
      reason: "설정은 17세",
      severity: "high",
      sceneStem: "  "
    })

    expect(named[0]?.sceneStem).toBe("02-meeting")
    expect(blank[0]?.sceneStem).toBeUndefined()
  })
})
