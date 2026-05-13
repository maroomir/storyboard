import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE } from "@/constants/projectStorageMessages"
import { parseCard, serializeCard } from "@/files/card"
import {
  parseSeed,
  SeedParseError,
  SEED_ENVELOPE_VERSION,
  serializeSeed
} from "@/models/serialization/seedFile"
import { storyboardProjectSchema } from "@/files/projectJson"

const cardsFixtureDirectory = join(process.cwd(), "test", "fixtures", "cards")

function minimalSeedJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    version: SEED_ENVELOPE_VERSION,
    project: {
      version: "1.0.0",
      id: "00000000-0000-4000-8000-000000000001",
      name: "테스트",
      format: "novel",
      language: "ko",
      createdAt: "2026-05-13T08:00:00.000Z",
      settings: { scenePrefixDigits: 2 }
    },
    characters: [
      {
        type: "character",
        id: "hero",
        name: "주인공"
      }
    ],
    backgrounds: [
      {
        type: "background",
        id: "school",
        name: "학교"
      }
    ],
    scenes: [{ stem: "01-prologue", content: "---\ntitle: 프롤로그\n---\n본문" }]
  }

  return JSON.stringify({ ...base, ...overrides }, null, 2)
}

describe("seedFile", () => {
  it("parses v2 envelope and normalizes project for disk (trackDraft default)", () => {
    const parsed = parseSeed(minimalSeedJson())

    expect(parsed.version).toBe(SEED_ENVELOPE_VERSION)
    expect(parsed.project.settings.trackDraft).toBe(false)
    expect(() => storyboardProjectSchema.parse(parsed.project)).not.toThrow()
  })

  it("keeps explicit trackDraft when present", () => {
    const raw = minimalSeedJson({
      project: {
        version: "1.0.0",
        id: "00000000-0000-4000-8000-000000000001",
        name: "테스트",
        format: "novel",
        language: "ko",
        createdAt: "2026-05-13T08:00:00.000Z",
        settings: { scenePrefixDigits: 2, trackDraft: true }
      }
    })

    expect(parseSeed(raw).project.settings.trackDraft).toBe(true)
  })

  it("round-trips parseSeed → serializeSeed → parseSeed", () => {
    const first = parseSeed(minimalSeedJson())
    const second = parseSeed(serializeSeed(first))

    expect(second).toEqual(first)
  })

  it("rejects legacy 1.2.0 envelope with the shared Korean message", () => {
    const legacy = JSON.stringify({ version: "1.2.0", project: {} })

    expect(() => parseSeed(legacy)).toThrow(SeedParseError)

    try {
      parseSeed(legacy)
    } catch (error) {
      expect(error).toBeInstanceOf(SeedParseError)
      expect((error as SeedParseError).code).toBe("legacy-envelope")
      expect((error as SeedParseError).message).toBe(UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE)
    }
  })

  it("rejects unsupported envelope versions", () => {
    const raw = minimalSeedJson({ version: "9.9.9" })

    expect(() => parseSeed(raw)).toThrow(SeedParseError)

    try {
      parseSeed(raw)
    } catch (error) {
      expect(error).toBeInstanceOf(SeedParseError)
      expect((error as SeedParseError).code).toBe("unsupported-envelope-version")
    }
  })

  it("rejects invalid JSON", () => {
    expect(() => parseSeed("{")).toThrow(SeedParseError)

    try {
      parseSeed("{")
    } catch (error) {
      expect((error as SeedParseError).code).toBe("invalid-json")
    }
  })

  it("rejects non-object root", () => {
    expect(() => parseSeed("[]")).toThrow(SeedParseError)
  })

  it("rejects invalid scene stem", () => {
    const raw = minimalSeedJson({
      scenes: [{ stem: "bad-stem", content: "x" }]
    })

    expect(() => parseSeed(raw)).toThrow(SeedParseError)

    try {
      parseSeed(raw)
    } catch (error) {
      expect((error as SeedParseError).code).toBe("schema-validation")
    }
  })

  it("validates characters and backgrounds against card schemas", () => {
    const badCharacter = minimalSeedJson({
      characters: [{ type: "character", id: "BAD_ID", name: "x" }]
    })

    expect(() => parseSeed(badCharacter)).toThrow(SeedParseError)
  })

  it("accepts fixture card YAML via parseCard and survives seed card round-trip in envelope", () => {
    const rawCard = readFileSync(join(cardsFixtureDirectory, "character.card"), "utf8")
    const card = parseCard(rawCard)

    const envelope = parseSeed(
      minimalSeedJson({
        characters: [card],
        backgrounds: [],
        scenes: []
      })
    )

    expect(serializeCard(envelope.characters[0]!)).toBe(rawCard)
  })
})
