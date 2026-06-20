import type { BibleCandidateRecord } from "../files/bibleCandidates"
import type { BibleFact, StoryBible } from "../shared/bible"

export interface CanonDiffResult {
  readonly pending: BibleFact[]
}

function factKey(fact: BibleFact): string {
  return `${fact.subject.kind}:${fact.subject.id}:${fact.key}`
}

export function diffCandidatesAgainstCanon(
  canon: StoryBible,
  candidateRecords: readonly BibleCandidateRecord[]
): CanonDiffResult {
  const canonKeys = new Set(
    canon.facts.filter((fact) => fact.status === "canon").map(factKey)
  )
  const seen = new Set<string>()
  const pending: BibleFact[] = []

  for (const record of candidateRecords) {
    for (const fact of record.facts) {
      const key = factKey(fact)
      if (canonKeys.has(key) || seen.has(key)) {
        continue
      }
      seen.add(key)
      pending.push(fact)
    }
  }

  return { pending }
}

export function buildCanonDiffMarkdown(projectName: string, pending: readonly BibleFact[]): string {
  const sections: string[] = ["# Canon Diff (미승격 설정 후보)", `> 대상: ${projectName}`]

  if (pending.length === 0) {
    sections.push("미승격 설정 후보가 없습니다.")
    return `${sections.join("\n\n")}\n`
  }

  const lines = pending.map(
    (fact) => `- [${fact.subject.kind}:${fact.subject.id}] ${fact.key}: ${fact.value}`
  )
  sections.push(
    "아직 `canon.yaml`로 승격되지 않은 자동 추출 설정입니다. `Promote Bible Candidates to Canon`으로 확정하세요.",
    lines.join("\n")
  )

  return `${sections.join("\n\n")}\n`
}
