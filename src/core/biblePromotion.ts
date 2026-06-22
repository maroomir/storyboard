import type { BibleFact, StoryBible } from "../shared/bible"
import type { BibleCandidateRecord } from "../files/bibleCandidates"
import { resolveSceneOrder } from "../shared/scene"

// NOTE: Anchor a freshly promoted fact to the scene it was first observed so it becomes a
// time-scoped canon version. The `@order` id suffix keeps it distinct from later versions of
// the same subject:key under id-keyed merge. Candidates without a resolvable sourceScene stay
// range-less (today's behavior); facts that already carry a validFrom are left untouched.
export function seedPromotedFact(fact: BibleFact): BibleFact {
  if (fact.validFrom !== undefined || fact.sourceScene === undefined) {
    return fact
  }

  const order = resolveSceneOrder(fact.sourceScene)
  if (order === undefined) {
    return fact
  }

  return {
    ...fact,
    id: `${fact.subject.kind}:${fact.subject.id}:${fact.key}@${order}`,
    validFrom: fact.sourceScene
  }
}

export function aggregateCandidateFacts(records: readonly BibleCandidateRecord[]): BibleFact[] {
  const byId = new Map<string, BibleFact>()

  for (const record of records) {
    for (const fact of record.facts) {
      byId.set(fact.id, fact)
    }
  }

  return [...byId.values()]
}

export function selectNewCandidates(candidates: readonly BibleFact[], canon: StoryBible): BibleFact[] {
  const canonIds = new Set(canon.facts.map((fact) => fact.id))

  return candidates.filter((fact) => !canonIds.has(fact.id))
}

export function mergeCanonFacts(canon: StoryBible, promoted: readonly BibleFact[]): StoryBible {
  const byId = new Map(canon.facts.map((fact) => [fact.id, fact] as const))

  for (const fact of promoted) {
    byId.set(fact.id, { ...fact, status: "canon" })
  }

  return { ...canon, facts: [...byId.values()] }
}
