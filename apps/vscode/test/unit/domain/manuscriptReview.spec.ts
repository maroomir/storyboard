import { describe, expect, it } from "vitest"

import { buildManuscriptReviewMarkdown } from "@storyboard/story-engine"

const baseInput = {
  projectName: "MagicBoy",
  sceneCount: 3,
  generatedAt: "2026-06-20T00:00:00.000Z"
}

describe("buildManuscriptReviewMarkdown", () => {
  it("reports no issues when both lists are empty", () => {
    const markdown = buildManuscriptReviewMarkdown({
      ...baseInput,
      continuityIssues: [],
      critiqueIssues: []
    })

    expect(markdown).toContain("# 원고 최종 검사 보고서")
    expect(markdown).toContain("발견된 이슈가 없습니다.")
    expect(markdown).not.toContain("## 요약")
  })

  it("Q13: renders the continuity split line and both issue sections", () => {
    const markdown = buildManuscriptReviewMarkdown({
      ...baseInput,
      continuityIssues: [
        { original: "녹색 눈", reason: "canon은 파란 눈", severity: "high" },
        { original: "왼손잡이", reason: "canon은 오른손잡이", severity: "low" },
        { original: "검은 머리", reason: "canon은 금발", severity: "low" }
      ],
      critiqueIssues: [
        { category: "voice", severity: "high", excerpt: "안녕", comment: "말투 어긋남" },
        { category: "repetition", severity: "low", comment: "표현 반복" }
      ]
    })

    expect(markdown).toContain("- 설정 모순(continuity): 3건 (high 1 / low 2)")
    expect(markdown).toContain("- 비평(critique): 2건 (high 1 / low 1)")
    expect(markdown).toContain('- "녹색 눈" — canon은 파란 눈')
    expect(markdown).toContain('- [캐릭터 보이스/high] 말투 어긋남 ("안녕")')
    expect(markdown).toContain("- [반복/low] 표현 반복")
  })

  it("marks empty sections as 없음 when only one issue type exists", () => {
    const markdown = buildManuscriptReviewMarkdown({
      ...baseInput,
      continuityIssues: [],
      critiqueIssues: [{ category: "purpose", severity: "high", comment: "목적 불명확" }]
    })

    expect(markdown).toContain("## 설정 모순 (continuity)\n\n_없음_")
    expect(markdown).toContain("- [장면 목적/high] 목적 불명확")
  })

  it("QAS-C3-10: renders the critique score line in the summary", () => {
    const markdown = buildManuscriptReviewMarkdown({
      ...baseInput,
      continuityIssues: [{ original: "녹색 눈", reason: "canon은 파란 눈", severity: "low" }],
      critiqueIssues: [{ category: "voice", severity: "high", excerpt: "안녕", comment: "말투 어긋남" }]
    })

    expect(markdown).toContain("비평 점수: 88/100")
  })

  it("QAS-C3-11: reports a perfect score on the empty-issue path alongside the no-issue line", () => {
    const markdown = buildManuscriptReviewMarkdown({
      ...baseInput,
      continuityIssues: [],
      critiqueIssues: []
    })

    expect(markdown).toContain("비평 점수: 100/100")
    expect(markdown).toContain("발견된 이슈가 없습니다.")
  })
})
