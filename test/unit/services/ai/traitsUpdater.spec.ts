import { describe, expect, it } from "vitest"

import type { CharacterCard } from "@/shared/card"
import type { CardFileSystem } from "@/files/card"
import { parseCard, serializeCard } from "@/files/card"
import {
  applyTraitsFromExtractedBullets,
  extractQuotedUtterancesForCharacter
} from "@/services/ai/traitsUpdater"

describe("extractQuotedUtterancesForCharacter", () => {
  it("collects double-quoted and corner-bracket speech for a speaker line", () => {
    const script = [
      "엘리아: \"안녕, 오늘 날씨가 좋네.\"",
      "지훈: 「응, 창문 밖을 봐도 맑다.」",
      "내레이션: 엘리아는 웃었다."
    ].join("\n")

    expect(extractQuotedUtterancesForCharacter(script, "엘리아")).toEqual(["안녕, 오늘 날씨가 좋네."])
    expect(extractQuotedUtterancesForCharacter(script, "지훈")).toEqual(["응, 창문 밖을 봐도 맑다."])
  })
})

describe("applyTraitsFromExtractedBullets", () => {
  it("merges processed traits and recent dialogues then serializes cards deterministically", async () => {
    const eliaCard: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      traits: ["기존에 있던 긴 특성 문장입니다"],
      recentDialogues: ["옛날 대사 한 줄입니다"]
    }

    const jihoonCard: CharacterCard = {
      type: "character",
      id: "jihoon",
      name: "지훈",
      traits: ["상황을 조심스럽게 관찰하고 판단함"],
      recentDialogues: []
    }

    const fileSystem = new MemoryCardFileSystem(
      new Map([
        ["/char/elia.card", serializeCard(eliaCard)],
        ["/char/jihoon.card", serializeCard(jihoonCard)]
      ])
    )

    const draftBody = [
      "엘리아: \"새로 나온 대사 한 줄입니다.\"",
      "지훈: \"주변을 살피며 조용히 말했다.\""
    ].join("\n")

    const rawByCharacter: Record<string, string> = {
      엘리아: `- 활발하게 교실 앞으로 걸어 나섬
- 친구를 안심시키며 또렷하게 말함`,
      지훈: `- 주변 친구들의 반응을 살피며 한발 물러섬`
    }

    const summary = await applyTraitsFromExtractedBullets({
      draftBody,
      detectedCharacterCards: [eliaCard, jihoonCard],
      rawResponsesByCharacter: rawByCharacter,
      fileSystem,
      resolveCharacterCardUri: (card) => `/char/${card.id}.card`,
      recentDialogueLimit: 3
    })

    expect(summary.updatedCardCount).toBe(2)
    expect(summary.skippedUnchangedCount).toBe(0)

    const writtenElia = parseCard(fileSystem.files.get("/char/elia.card") ?? "")
    const writtenJihoon = parseCard(fileSystem.files.get("/char/jihoon.card") ?? "")

    expect(writtenElia.type).toBe("character")
    expect(writtenJihoon.type).toBe("character")

    if (writtenElia.type === "character" && writtenJihoon.type === "character") {
      expect(writtenElia.traits).toEqual([
        "기존에 있던 긴 특성 문장입니다",
        "활발하게 교실 앞으로 걸어 나섬",
        "친구를 안심시키며 또렷하게 말함"
      ])
      expect(writtenElia.recentDialogues).toEqual(["옛날 대사 한 줄입니다", "새로 나온 대사 한 줄입니다."])

      expect(writtenJihoon.traits).toEqual([
        "상황을 조심스럽게 관찰하고 판단함",
        "주변 친구들의 반응을 살피며 한발 물러섬"
      ])
      expect(writtenJihoon.recentDialogues).toEqual(["주변을 살피며 조용히 말했다."])
    }
  })
})

class MemoryCardFileSystem implements CardFileSystem {
  public constructor(public readonly files: Map<string, string>) {}

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const path = uri as string
    const content = this.files.get(path)

    if (content === undefined) {
      throw new Error(`missing ${path}`)
    }

    return new TextEncoder().encode(content)
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    this.files.set(uri as string, new TextDecoder().decode(content))
  }
}
