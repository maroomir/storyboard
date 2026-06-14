import { describe, expect, it } from "vitest"

import { aggregateCandidateFacts, mergeCanonFacts, selectNewCandidates } from "@/core/biblePromotion"
import { buildCandidateFact, type StoryBible } from "@/shared/bible"
import type { BibleCandidateRecord } from "@/files/bibleCandidates"

function candidateRecord(sceneStem: string, facts: BibleCandidateRecord["facts"]): BibleCandidateRecord {
  return { sceneStem, generatedAt: "2026-06-14T09:00:00.000Z", facts }
}

describe("aggregateCandidateFacts", () => {
  it("dedupes facts by id across records, keeping the latest value", () => {
    const records = [
      candidateRecord("01-prologue", [buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "파란색")]),
      candidateRecord("02-chapter", [buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "녹색")])
    ]

    const facts = aggregateCandidateFacts(records)

    expect(facts).toHaveLength(1)
    expect(facts[0]?.value).toBe("녹색")
  })
})

describe("selectNewCandidates", () => {
  const canon: StoryBible = {
    version: "1.0.0",
    facts: [{ id: "character:elia:눈동자 색", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" }]
  }

  it("excludes candidates already present in canon with the same value", () => {
    const candidates = [buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "녹색")]

    expect(selectNewCandidates(candidates, canon)).toEqual([])
  })

  it("keeps candidates whose value differs from canon", () => {
    const candidates = [buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "파란색")]

    expect(selectNewCandidates(candidates, canon).map((fact) => fact.value)).toEqual(["파란색"])
  })
})

describe("mergeCanonFacts", () => {
  it("adds promoted facts as canon and overrides the same id", () => {
    const canon: StoryBible = {
      version: "1.0.0",
      facts: [{ id: "character:elia:눈동자 색", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "파란색", status: "canon" }]
    }
    const promoted = [
      buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "녹색"),
      buildCandidateFact({ kind: "character", id: "jihoon" }, "키", "180cm")
    ]

    const merged = mergeCanonFacts(canon, promoted)

    expect(merged.facts).toHaveLength(2)
    expect(merged.facts.every((fact) => fact.status === "canon")).toBe(true)
    expect(merged.facts.find((fact) => fact.subject.id === "elia")?.value).toBe("녹색")
  })
})
