import type { ContinuityIssueLike, CritiqueCategory, DraftCritiqueIssue } from "../shared/draftReview"

export interface ManuscriptReviewInput {
  readonly projectName: string
  readonly sceneCount: number
  readonly generatedAt: string
  readonly continuityIssues: readonly ContinuityIssueLike[]
  readonly critiqueIssues: readonly DraftCritiqueIssue[]
}

const categoryLabels: Record<CritiqueCategory, string> = {
  voice: "캐릭터 보이스",
  purpose: "장면 목적",
  repetition: "반복"
}

export function buildManuscriptReviewMarkdown(input: ManuscriptReviewInput): string {
  const highCount = input.critiqueIssues.filter((issue) => issue.severity === "high").length
  const lowCount = input.critiqueIssues.length - highCount
  const continuityHigh = input.continuityIssues.filter((issue) => issue.severity === "high").length
  const continuityLow = input.continuityIssues.length - continuityHigh
  const total = input.continuityIssues.length + input.critiqueIssues.length

  const sections: string[] = [
    "# 원고 최종 검사 보고서",
    `> 생성: ${input.generatedAt}\n> 대상: ${input.projectName} · 씬 ${input.sceneCount}개`
  ]

  if (total === 0) {
    sections.push("발견된 이슈가 없습니다.")
    return `${sections.join("\n\n")}\n`
  }

  sections.push(
    [
      "## 요약",
      `- 설정 모순(continuity): ${input.continuityIssues.length}건 (high ${continuityHigh} / low ${continuityLow})`,
      `- 비평(critique): ${input.critiqueIssues.length}건 (high ${highCount} / low ${lowCount})`
    ].join("\n")
  )

  sections.push(buildContinuitySection(input.continuityIssues))
  sections.push(buildCritiqueSection(input.critiqueIssues))

  return `${sections.join("\n\n")}\n`
}

function buildContinuitySection(issues: readonly ContinuityIssueLike[]): string {
  const lines = issues.map((issue) => `- "${issue.original}" — ${issue.reason}`)
  return `## 설정 모순 (continuity)\n\n${lines.length > 0 ? lines.join("\n") : "_없음_"}`
}

function buildCritiqueSection(issues: readonly DraftCritiqueIssue[]): string {
  const lines = issues.map((issue) => {
    const excerpt = issue.excerpt ? ` ("${issue.excerpt}")` : ""
    return `- [${categoryLabels[issue.category]}/${issue.severity}] ${issue.comment}${excerpt}`
  })
  return `## 비평 (voice/purpose/repetition)\n\n${lines.length > 0 ? lines.join("\n") : "_없음_"}`
}
