import { describe, expect, it } from "vitest"

import { parseBibleCandidates, serializeBibleCandidates, type BibleCandidateRecord } from "@/files/bibleCandidates"
import { buildCandidateFact } from "@/shared/bible"

const record: BibleCandidateRecord = {
  sceneStem: "01-prologue",
  generatedAt: "2026-06-14T09:00:00.000Z",
  facts: [
    buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "녹색", "01-prologue"),
    buildCandidateFact({ kind: "character", id: "jihoon" }, "키", "180cm")
  ]
}

describe("bible candidate codec", () => {
  it("serializes and parses a candidate record round trip", () => {
    expect(parseBibleCandidates(serializeBibleCandidates(record))).toEqual(record)
  })

  it("marks built facts as candidate with a deterministic id", () => {
    const fact = buildCandidateFact({ kind: "character", id: "elia" }, "눈동자 색", "녹색")

    expect(fact.status).toBe("candidate")
    expect(fact.id).toBe("character:elia:눈동자 색")
  })
})
