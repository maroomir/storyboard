import type { BibleCandidateRecord } from "../files/bibleCandidates"
import type { BibleFact, StoryBible } from "../shared/bible"
import { resolveSceneOrder } from "../shared/scene"

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

export function buildCanonDiffMarkdown(
  projectName: string,
  pending: readonly BibleFact[],
  canon?: StoryBible
): string {
  const sections: string[] = ["# Canon Diff (미승격 설정 후보)", `> 대상: ${projectName}`]

  if (pending.length === 0) {
    sections.push("미승격 설정 후보가 없습니다.")
  } else {
    const lines = pending.map(
      (fact) => `- [${fact.subject.kind}:${fact.subject.id}] ${fact.key}: ${fact.value}`
    )
    sections.push(
      "아직 `canon.yaml`로 승격되지 않은 자동 추출 설정입니다. `Promote Bible Candidates to Canon`으로 확정하세요.",
      lines.join("\n")
    )
  }

  const timeline = canon ? buildCanonTimelineSection(canon) : undefined
  if (timeline) {
    sections.push(timeline)
  }

  return `${sections.join("\n\n")}\n`
}

function rangeStart(fact: BibleFact): number {
  return fact.validFrom === undefined
    ? Number.NEGATIVE_INFINITY
    : resolveSceneOrder(fact.validFrom) ?? Number.NEGATIVE_INFINITY
}

function formatBound(bound: string | number): string {
  const order = resolveSceneOrder(bound)
  return order === undefined ? String(bound) : String(order).padStart(2, "0")
}

function formatRangeLabel(fact: BibleFact): string {
  const left = fact.validFrom === undefined ? "…" : formatBound(fact.validFrom)
  const right = fact.validUntil === undefined ? "" : formatBound(fact.validUntil)
  return `${left}–${right}`
}

// NOTE: Surfaces canon facts that have more than one time-scoped version as an ordered
// timeline so authors can verify the cutover scene. Single-version facts are omitted here.
function buildCanonTimelineSection(canon: StoryBible): string | undefined {
  const groups = new Map<string, BibleFact[]>()

  for (const fact of canon.facts) {
    if (fact.status !== "canon") {
      continue
    }
    const key = factKey(fact)
    const group = groups.get(key)
    if (group) {
      group.push(fact)
    } else {
      groups.set(key, [fact])
    }
  }

  const blocks: string[] = []

  for (const facts of groups.values()) {
    if (facts.length < 2) {
      continue
    }
    // NOTE: Compare without subtraction so two open-start versions (both -Infinity) sort
    // stably instead of producing NaN, which would leave the timeline order undefined.
    const sorted = [...facts].sort((left, right) => {
      const leftStart = rangeStart(left)
      const rightStart = rangeStart(right)
      if (leftStart === rightStart) {
        return 0
      }
      return leftStart < rightStart ? -1 : 1
    })
    const { subject, key } = facts[0] as BibleFact
    const lines = sorted.map((fact) => `- \`${formatRangeLabel(fact)}\`: ${fact.value}`)
    blocks.push([`### [${subject.kind}:${subject.id}] ${key}`, ...lines].join("\n"))
  }

  if (blocks.length === 0) {
    return undefined
  }

  return ["## 설정 변경 타임라인", ...blocks].join("\n\n")
}
