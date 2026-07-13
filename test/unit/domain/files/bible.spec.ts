import { describe, expect, it } from "vitest"

import { BibleParseError, parseBible, serializeBible } from "@/domain/files/bible"
import type { StoryBible } from "@/shared/bible"

const bible: StoryBible = {
  version: "1.0.0",
  facts: [
    { id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" },
    {
      id: "f2",
      subject: { kind: "background", id: "school" },
      key: "위치",
      value: "도시 외곽",
      status: "canon",
      sourceScene: "01-prologue"
    }
  ]
}

describe("bible codec", () => {
  it("serializes and parses a bible round trip", () => {
    expect(parseBible(serializeBible(bible))).toEqual(bible)
  })

  it("defaults a fact status to canon when omitted", () => {
    const raw = [
      "version: 1.0.0",
      "facts:",
      "  - id: f1",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 눈동자 색",
      "    value: 녹색"
    ].join("\n")

    expect(parseBible(raw).facts[0]?.status).toBe("canon")
  })

  it("throws BibleParseError on invalid YAML", () => {
    expect(() => parseBible(":\n  - broken: [")).toThrow(BibleParseError)
  })

  it("throws BibleParseError on schema violations", () => {
    expect(() => parseBible("version: 9.9.9\nfacts: []")).toThrow(BibleParseError)
  })
})

describe("bible range compatibility", () => {
  const legacyBible: StoryBible = {
    version: "1.0.0",
    facts: [
      { id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" },
      { id: "f2", subject: { kind: "background", id: "school" }, key: "위치", value: "도시 외곽", status: "canon" }
    ]
  }

  it("round-trips a range-less bible without introducing range keys", () => {
    const serialized = serializeBible(legacyBible)

    expect(serialized).not.toContain("validFrom")
    expect(serialized).not.toContain("validUntil")
    expect(parseBible(serialized)).toEqual(legacyBible)
  })

  it("throws BibleParseError with invalid-bible-schema on an unparseable range bound", () => {
    const raw = [
      "version: 1.0.0",
      "facts:",
      "  - id: f1",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 팔",
      "    value: 의수",
      "    validFrom: banana"
    ].join("\n")

    try {
      parseBible(raw)
      throw new Error("expected parseBible to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(BibleParseError)
      expect((error as BibleParseError).code).toBe("invalid-bible-schema")
    }
  })

  it("accepts numeric and NN-slug range bounds without requiring a scene file", () => {
    const raw = [
      "version: 1.0.0",
      "facts:",
      "  - id: f1",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 팔",
      "    value: 멀쩡함",
      "    validUntil: 3",
      "  - id: f2",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 팔",
      "    value: 의수",
      "    validFrom: 04-the-fall"
    ].join("\n")

    const parsed = parseBible(raw)

    expect(parsed.facts[0]?.validUntil).toBe(3)
    expect(parsed.facts[1]?.validFrom).toBe("04-the-fall")
  })
})

describe("bible keywords compatibility", () => {
  it("QAS-C5-12b: round-trips a keywords array verbatim", () => {
    const bibleWithKeywords: StoryBible = {
      version: "1.0.0",
      facts: [
        {
          id: "f1",
          subject: { kind: "background", id: "crimson-empire" },
          key: "통치",
          value: "검붉은 깃발",
          status: "canon",
          keywords: ["Crimson Empire", "붉은 제국"]
        }
      ]
    }

    const roundTripped = parseBible(serializeBible(bibleWithKeywords))

    expect(roundTripped.facts[0]?.keywords).toEqual(["Crimson Empire", "붉은 제국"])
  })

  it("QAS-C5-12b: emits no keywords key for a fact without keywords", () => {
    const keywordlessBible: StoryBible = {
      version: "1.0.0",
      facts: [{ id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" }]
    }

    const serialized = serializeBible(keywordlessBible)

    expect(serialized).not.toContain("keywords")
    expect(parseBible(serialized)).toEqual(keywordlessBible)
  })

  it("QAS-C5-12b: rejects an empty-string keyword as invalid-bible-schema", () => {
    const raw = [
      "version: 1.0.0",
      "facts:",
      "  - id: f1",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 팔",
      "    value: 의수",
      "    keywords:",
      '      - ""'
    ].join("\n")

    try {
      parseBible(raw)
      throw new Error("expected parseBible to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(BibleParseError)
      expect((error as BibleParseError).code).toBe("invalid-bible-schema")
    }
  })

  it("QAS-C5-12b: rejects a non-string keyword as invalid-bible-schema", () => {
    const raw = [
      "version: 1.0.0",
      "facts:",
      "  - id: f1",
      "    subject:",
      "      kind: character",
      "      id: elia",
      "    key: 팔",
      "    value: 의수",
      "    keywords:",
      "      - 3"
    ].join("\n")

    try {
      parseBible(raw)
      throw new Error("expected parseBible to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(BibleParseError)
      expect((error as BibleParseError).code).toBe("invalid-bible-schema")
    }
  })
})
