import { z } from "zod"

export const storyBibleVersion = "1.0.0"

export const bibleFactStatuses = ["canon", "candidate"] as const
export type BibleFactStatus = (typeof bibleFactStatuses)[number]

export const bibleSubjectKinds = ["character", "background"] as const
export type BibleSubjectKind = (typeof bibleSubjectKinds)[number]

export const bibleFactSubjectSchema = z.object({
  kind: z.enum(bibleSubjectKinds),
  id: z.string().trim().min(1)
})

export const bibleFactSchema = z.object({
  id: z.string().trim().min(1),
  subject: bibleFactSubjectSchema,
  key: z.string().trim().min(1),
  value: z.string().trim().min(1),
  status: z.enum(bibleFactStatuses).default("canon"),
  sourceScene: z.string().trim().min(1).optional()
})

export const storyBibleSchema = z.object({
  version: z.literal(storyBibleVersion),
  facts: z.array(bibleFactSchema).default([])
})

export type BibleFactSubject = z.infer<typeof bibleFactSubjectSchema>
export type BibleFact = z.infer<typeof bibleFactSchema>
export type StoryBible = z.infer<typeof storyBibleSchema>

export function createEmptyBible(): StoryBible {
  return { version: storyBibleVersion, facts: [] }
}

// NOTE: id is deterministic from subject+key so re-extracting the same fact stays stable for dedup.
export function buildCandidateFact(
  subject: BibleFactSubject,
  key: string,
  value: string,
  sourceScene?: string
): BibleFact {
  return {
    id: `${subject.kind}:${subject.id}:${key}`,
    subject,
    key,
    value,
    status: "candidate",
    ...(sourceScene ? { sourceScene } : {})
  }
}

// NOTE: Retrieval only injects author-confirmed canon, never auto-extracted candidates.
export function selectBibleFacts(
  bible: StoryBible,
  subjects: readonly BibleFactSubject[]
): BibleFact[] {
  if (subjects.length === 0) {
    return []
  }

  const wanted = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`))

  return bible.facts.filter(
    (fact) => fact.status === "canon" && wanted.has(`${fact.subject.kind}:${fact.subject.id}`)
  )
}
