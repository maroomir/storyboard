import { describe, expect, it } from "vitest"

import { BibleParseError, parseBible, serializeBible } from "@/files/bible"
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
