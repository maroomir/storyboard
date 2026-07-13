import { describe, expect, it } from "vitest"

import { updateBackgroundCharactersFromScene } from "@/services/ai/backgroundCharacterUpdater"
import { parseCard, serializeCard, type CardFileSystem } from "@/domain/files/card"
import type { BackgroundCard, CharacterCard } from "@/shared/card"

const elia: CharacterCard = { type: "character", id: "elia", name: "엘리아" }
const jihoon: CharacterCard = { type: "character", id: "jihoon", name: "지훈" }

function backgroundCard(characterIds: string[]): BackgroundCard {
  return { type: "location", id: "school", name: "학교 정문", description: [], characterIds, tags: [], locationKind: "place" }
}

class MemoryCardFileSystem implements CardFileSystem {
  public constructor(public readonly files: Map<string, string>) {}

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const content = this.files.get(uri as string)
    if (content === undefined) {
      throw new Error(`missing ${uri as string}`)
    }
    return new TextEncoder().encode(content)
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    this.files.set(uri as string, new TextDecoder().decode(content))
  }
}

const cardUri = "/bg/school.card"

describe("updateBackgroundCharactersFromScene", () => {
  it("adds detected character ids to an empty background", async () => {
    const fileSystem = new MemoryCardFileSystem(new Map([[cardUri, serializeCard(backgroundCard([]))]]))

    const summary = await updateBackgroundCharactersFromScene({
      backgroundId: "school",
      detectedCharacterCards: [elia, jihoon],
      fileSystem,
      resolveBackgroundCardUri: () => cardUri
    })

    expect(summary.updated).toBe(true)
    const stored = parseCard(fileSystem.files.get(cardUri) ?? "")
    expect(stored.type === "location" && stored.characterIds).toEqual(["elia", "jihoon"])
  })

  it("merges without duplicating existing ids", async () => {
    const fileSystem = new MemoryCardFileSystem(new Map([[cardUri, serializeCard(backgroundCard(["elia"]))]]))

    const summary = await updateBackgroundCharactersFromScene({
      backgroundId: "school",
      detectedCharacterCards: [elia, jihoon],
      fileSystem,
      resolveBackgroundCardUri: () => cardUri
    })

    expect(summary.updated).toBe(true)
    const stored = parseCard(fileSystem.files.get(cardUri) ?? "")
    expect(stored.type === "location" && stored.characterIds).toEqual(["elia", "jihoon"])
  })

  it("skips when all detected ids are already present", async () => {
    const fileSystem = new MemoryCardFileSystem(new Map([[cardUri, serializeCard(backgroundCard(["elia"]))]]))

    const summary = await updateBackgroundCharactersFromScene({
      backgroundId: "school",
      detectedCharacterCards: [elia],
      fileSystem,
      resolveBackgroundCardUri: () => cardUri
    })

    expect(summary.updated).toBe(false)
  })

  it("skips when no characters are detected", async () => {
    const fileSystem = new MemoryCardFileSystem(new Map([[cardUri, serializeCard(backgroundCard([]))]]))

    const summary = await updateBackgroundCharactersFromScene({
      backgroundId: "school",
      detectedCharacterCards: [],
      fileSystem,
      resolveBackgroundCardUri: () => cardUri
    })

    expect(summary.updated).toBe(false)
  })
})
