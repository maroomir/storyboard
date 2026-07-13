import { describe, expect, it } from "vitest"

import { parseProjectJson } from "@/infrastructure/persistence/projectJson"
import {
  applySeedIdMapping,
  SeedIdMappingConflictError,
  SeedIdMappingValidationError,
  validateSeedIdMapping
} from "@/infrastructure/seedcoat/seedRemap"
import type { DecodedSeedContent } from "@/services/seedcoat/projectAdapter"

function minimalSeed(overrides?: Partial<DecodedSeedContent>): DecodedSeedContent {
  return {
    project: parseProjectJson(
      JSON.stringify({
        version: "1.0.0",
        id: "00000000-0000-4000-8000-000000000001",
        name: "테스트",
        format: "novel",
        language: "ko",
        createdAt: "2026-05-13T08:00:00.000Z",
        editor: { scenePrefixDigits: 2 }
      })
    ),
    characters: [
      {
        type: "character",
        id: "item",
        name: "주인공",
        relations: [{ target: "item-2", type: "rival" }]
      },
      { type: "character", id: "item-2", name: "라이벌" }
    ],
    backgrounds: [
      {
        type: "location",
        id: "bg-item",
        name: "배경",
        locationKind: "place",
        characterIds: ["item", "item-2"],
        tags: [],
        description: []
      }
    ],
    scenes: [{ stem: "01-prologue", content: "scene\n" }],
    ...overrides
  }
}

describe("seedRemap", () => {
  it("returns the same seed when mapping is empty", () => {
    const seed = minimalSeed()

    expect(applySeedIdMapping(seed, new Map())).toBe(seed)
  })

  it("remaps card ids and propagates references", () => {
    const seed = minimalSeed()
    const mapping = new Map([
      ["item", "hero"],
      ["item-2", "rival"]
    ])

    const remapped = applySeedIdMapping(seed, mapping)

    expect(remapped.characters.map((card) => card.id)).toEqual(["hero", "rival"])
    expect(remapped.characters[0]?.relations).toEqual([{ target: "rival", type: "rival" }])
    expect(remapped.backgrounds[0]?.characterIds).toEqual(["hero", "rival"])
    expect(remapped.scenes).toBe(seed.scenes)
    expect(remapped.project).toBe(seed.project)
  })

  it("leaves unmapped ids unchanged", () => {
    const seed = minimalSeed()
    const remapped = applySeedIdMapping(seed, new Map([["item", "hero"]]))

    expect(remapped.characters.map((card) => card.id)).toEqual(["hero", "item-2"])
    expect(remapped.backgrounds[0]?.characterIds).toEqual(["hero", "item-2"])
  })

  it("rejects invalid target ids", () => {
    const seed = minimalSeed()

    expect(() => validateSeedIdMapping(seed, new Map([["item", "Bad Id"]]))).toThrow(
      SeedIdMappingValidationError
    )
  })

  it("rejects duplicate target ids from different sources", () => {
    const seed = minimalSeed()

    expect(() => validateSeedIdMapping(seed, new Map([
      ["item", "hero"],
      ["item-2", "hero"]
    ]))).toThrow(SeedIdMappingConflictError)
  })

  it("rejects remaps that collide with an existing unmapped card id", () => {
    const seed = minimalSeed()

    expect(() => validateSeedIdMapping(seed, new Map([["item", "item-2"]]))).toThrow(
      SeedIdMappingConflictError
    )
  })
})
