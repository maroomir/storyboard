import { describe, expect, it } from "vitest"

import type { BackgroundCard, CharacterCard } from "@/shared/card"
import {
  computeBackgroundCardHash,
  computePersonaCardHash,
  parseBackgroundMemory,
  parsePersonaMemory,
  serializeBackgroundMemory,
  serializePersonaMemory,
  type BackgroundMemoryRecord,
  type PersonaMemoryRecord
} from "@/files/cardMemory"

const eliaCard: CharacterCard = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main",
  voice: ["단정한 말투"],
  description: ["호기심 많은 학생"],
  traits: ["관찰력이 좋음"]
}

const schoolCard: BackgroundCard = {
  type: "location",
  id: "school",
  name: "학교",
  locationKind: "place",
  characterIds: [],
  tags: ["일상"],
  description: ["낡은 복도와 교실"]
}

describe("persona memory codec", () => {
  it("serializes and parses a persona memory record", () => {
    const record: PersonaMemoryRecord = {
      cardId: "elia",
      persona: "나는 엘리아다.",
      updatedThroughScene: "03-classroom",
      cardHash: computePersonaCardHash(eliaCard)
    }

    expect(parsePersonaMemory(serializePersonaMemory(record))).toEqual(record)
  })

  it("changes the persona hash when a meaningful card field changes", () => {
    const baseHash = computePersonaCardHash(eliaCard)
    const renamedHash = computePersonaCardHash({ ...eliaCard, name: "엘리" })
    const revoicedHash = computePersonaCardHash({ ...eliaCard, voice: ["거친 말투"] })

    expect(baseHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(renamedHash).not.toBe(baseHash)
    expect(revoicedHash).not.toBe(baseHash)
  })

  it("keeps the persona hash stable when unrelated card fields change", () => {
    const baseHash = computePersonaCardHash(eliaCard)
    const withTags = computePersonaCardHash({ ...eliaCard, tags: ["새 태그"] })

    expect(withTags).toBe(baseHash)
  })

  it("changes the persona hash when attributes change", () => {
    const baseHash = computePersonaCardHash(eliaCard)
    const withAttributes = computePersonaCardHash({ ...eliaCard, attributes: { mbti: "ENFJ" } })

    expect(withAttributes).not.toBe(baseHash)
  })

  it("keeps the persona hash stable regardless of attribute key order", () => {
    const ordered = computePersonaCardHash({ ...eliaCard, attributes: { age: 17, mbti: "ENFJ", sex: "female" } })
    const shuffled = computePersonaCardHash({ ...eliaCard, attributes: { sex: "female", age: 17, mbti: "ENFJ" } })

    expect(shuffled).toBe(ordered)
  })
})

describe("background memory codec", () => {
  it("serializes and parses a background memory record", () => {
    const record: BackgroundMemoryRecord = {
      cardId: "school",
      atmosphere: "낡은 복도에 분필 냄새가 떠돈다.",
      updatedThroughScene: "03-classroom",
      cardHash: computeBackgroundCardHash(schoolCard)
    }

    expect(parseBackgroundMemory(serializeBackgroundMemory(record))).toEqual(record)
  })

  it("changes the background hash when description changes", () => {
    const baseHash = computeBackgroundCardHash(schoolCard)
    const changedHash = computeBackgroundCardHash({ ...schoolCard, description: ["새 건물"] })

    expect(baseHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(changedHash).not.toBe(baseHash)
  })
})
