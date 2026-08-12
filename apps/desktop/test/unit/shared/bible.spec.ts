import { describe, expect, it } from "vitest"

import { createEmptyBible, parseBible, selectBibleFacts } from '@seedkernel/wasm';

// Fact validation lives in the wasm engine; a single fact is checked by parsing a one-fact bible.
const bibleFactSchema = {
  safeParse: (fact: unknown): { success: boolean } => {
    try {
      parseBible(JSON.stringify({ version: '1.0.0', facts: [fact] }));
      return { success: true };
    } catch {
      return { success: false };
    }
  },
};
import type { StoryBible } from '@seedkernel/wasm';

const bible: StoryBible = {
  version: "1.0.0",
  facts: [
    { id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" },
    { id: "f2", subject: { kind: "character", id: "jihoon" }, key: "키", value: "180cm", status: "canon" },
    { id: "f3", subject: { kind: "character", id: "elia" }, key: "취미", value: "검술", status: "candidate" },
    { id: "f4", subject: { kind: "background", id: "school" }, key: "위치", value: "도시 외곽", status: "canon" }
  ]
}

describe("createEmptyBible", () => {
  it("creates a versioned empty bible", () => {
    expect(createEmptyBible()).toEqual({ version: "1.0.0", facts: [] })
  })
})

describe("selectBibleFacts", () => {
  it("returns only canon facts for the requested subjects", () => {
    const facts = selectBibleFacts(bible, [{ kind: "character", id: "elia" }])

    expect(facts.map((fact) => fact.id)).toEqual(["f1"])
  })

  it("matches subjects across kinds and ids", () => {
    const facts = selectBibleFacts(bible, [
      { kind: "character", id: "jihoon" },
      { kind: "background", id: "school" }
    ])

    expect(facts.map((fact) => fact.id)).toEqual(["f2", "f4"])
  })

  it("excludes candidate facts even when the subject matches", () => {
    const facts = selectBibleFacts(bible, [{ kind: "character", id: "elia" }])

    expect(facts.some((fact) => fact.status === "candidate")).toBe(false)
  })

  it("returns nothing when no subjects are requested", () => {
    expect(selectBibleFacts(bible, [])).toEqual([])
  })
})

describe("bibleFactSchema range bounds", () => {
  const baseFact = {
    id: "f1",
    subject: { kind: "character", id: "elia" },
    key: "팔",
    value: "의수",
    status: "canon"
  }

  it("validates a range-less fact", () => {
    expect(bibleFactSchema.safeParse(baseFact).success).toBe(true)
  })

  it("validates string range bounds", () => {
    const result = bibleFactSchema.safeParse({ ...baseFact, validFrom: "04-the-fall", validUntil: "07-x" })

    expect(result.success).toBe(true)
  })

  it("validates numeric range bounds", () => {
    const result = bibleFactSchema.safeParse({ ...baseFact, validFrom: 4, validUntil: 7 })

    expect(result.success).toBe(true)
  })

  it("rejects an unparseable string bound", () => {
    expect(bibleFactSchema.safeParse({ ...baseFact, validFrom: "banana" }).success).toBe(false)
  })

  it("parses an inverted range without error (validity is the resolver's concern)", () => {
    expect(bibleFactSchema.safeParse({ ...baseFact, validFrom: 8, validUntil: 5 }).success).toBe(true)
  })
})

describe("bibleFactSchema keywords", () => {
  const baseFact = {
    id: "f1",
    subject: { kind: "character", id: "elia" },
    key: "팔",
    value: "의수",
    status: "canon"
  }

  it("QAS-C5-12a: accepts a non-empty keywords array, rejects empty or non-string entries", () => {
    expect(bibleFactSchema.safeParse({ ...baseFact, keywords: ["a", "붉은 제국"] }).success).toBe(true)
    expect(bibleFactSchema.safeParse({ ...baseFact, keywords: [""] }).success).toBe(false)
    expect(bibleFactSchema.safeParse({ ...baseFact, keywords: [3] }).success).toBe(false)
    expect(bibleFactSchema.safeParse(baseFact).success).toBe(true)
  })
})
