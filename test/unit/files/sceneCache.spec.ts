import { describe, expect, it } from "vitest"

import type { BackgroundCard, CharacterCard } from "@/shared/card"
import {
  computeSceneInputHash,
  parseSceneCache,
  serializeSceneCache,
  type SceneCacheRecord
} from "@/files/sceneCache"

const sampleCharacter: CharacterCard = {
  type: "character",
  id: "sample",
  name: "샘플 캐릭터",
  role: "main",
  traits: ["호기심이 많음"],
  tags: ["샘플"],
  description: "테스트 캐릭터",
  recentDialogues: ["시작해볼까?"]
}

const sampleBackground: BackgroundCard = {
  type: "location",
  id: "sample",
  name: "샘플 배경",
  locationKind: "place",
  characterIds: [],
  tags: ["샘플"],
  description: "테스트 배경"
}

describe("scene cache codec", () => {
  it("serializes and parses a scene cache record", () => {
    const inputHash = computeSceneInputHash({
      sceneBody: "샘플 캐릭터가 등장한다.",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const record: SceneCacheRecord = {
      sceneStem: "01-prologue",
      generatedAt: "2026-05-03T14:00:00.000Z",
      inputHash,
      input: "샘플 캐릭터가 등장한다.",
      detectedCharacters: ["sample"],
      extractedSituations: [{ summary: "샘플 캐릭터가 등장한다.", characters: ["sample"] }],
      personasUsed: { sample: "나는 샘플 캐릭터다." },
      backgroundSnapshot: {
        id: "sample",
        name: "샘플 배경",
        description: "테스트 배경"
      },
      providers: {
        situationExtraction: "mock",
        personaGeneration: "mock",
        personaDialogue: "mock",
        sceneDraft: "mock",
        traitsExtraction: "mock"
      }
    }

    expect(parseSceneCache(serializeSceneCache(record))).toEqual(record)
  })

  it("creates a deterministic hash from scene inputs", () => {
    const firstHash = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const secondHash = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const changedHash = computeSceneInputHash({
      sceneBody: "다른 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(changedHash).not.toBe(firstHash)
  })
})