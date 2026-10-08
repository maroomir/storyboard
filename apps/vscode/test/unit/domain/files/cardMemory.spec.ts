import { describe, expect, it } from "vitest"

import type { BackgroundCard, CharacterCard } from '@storyboard/story-model';
import {
  computeBackgroundCardHash,
  computePersonaCardHash,
  parseBackgroundMemory,
  parsePersonaMemory,
  serializeBackgroundMemory,
  serializePersonaMemory,
  type BackgroundMemoryRecord,
  type PersonaMemoryRecord
} from "@storyboard/story-model"

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

const personaPrompt = "persona prompt v1"

describe("persona memory codec", () => {
  it("serializes and parses a persona memory record", () => {
    const record: PersonaMemoryRecord = {
      cardId: "elia",
      persona: "나는 엘리아다.",
      updatedThroughScene: "03-classroom",
      cardHash: computePersonaCardHash(eliaCard, personaPrompt)
    }

    expect(parsePersonaMemory(serializePersonaMemory(record))).toEqual(record)
  })

  it("changes the persona hash when a meaningful card field changes", () => {
    const baseHash = computePersonaCardHash(eliaCard, personaPrompt)
    const renamedHash = computePersonaCardHash({ ...eliaCard, name: "엘리" }, personaPrompt)
    const revoicedHash = computePersonaCardHash({ ...eliaCard, voice: ["거친 말투"] }, personaPrompt)

    expect(baseHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(renamedHash).not.toBe(baseHash)
    expect(revoicedHash).not.toBe(baseHash)
  })

  it("changes the persona hash when the persona prompt changes", () => {
    const baseHash = computePersonaCardHash(eliaCard, personaPrompt)
    const rewordedHash = computePersonaCardHash(eliaCard, "persona prompt v2")

    expect(rewordedHash).not.toBe(baseHash)
  })

  it("keeps the persona hash stable when unrelated card fields change", () => {
    const baseHash = computePersonaCardHash(eliaCard, personaPrompt)
    const withTags = computePersonaCardHash({ ...eliaCard, tags: ["새 태그"] }, personaPrompt)

    expect(withTags).toBe(baseHash)
  })

  it("changes the persona hash when attributes change", () => {
    const baseHash = computePersonaCardHash(eliaCard, personaPrompt)
    const withAttributes = computePersonaCardHash({ ...eliaCard, attributes: { mbti: "ENFJ" } }, personaPrompt)

    expect(withAttributes).not.toBe(baseHash)
  })

  it("keeps the persona hash stable regardless of attribute key order", () => {
    const ordered = computePersonaCardHash({ ...eliaCard, attributes: { age: 17, mbti: "ENFJ", sex: "female" } }, personaPrompt)
    const shuffled = computePersonaCardHash({ ...eliaCard, attributes: { sex: "female", age: 17, mbti: "ENFJ" } }, personaPrompt)

    expect(shuffled).toBe(ordered)
  })

  it("changes the persona hash when desire changes", () => {
    const baseHash = computePersonaCardHash(eliaCard, personaPrompt)
    const withDesire = computePersonaCardHash({ ...eliaCard, desire: ["친구를 사귀고 싶다"] }, personaPrompt)

    expect(withDesire).not.toBe(baseHash)
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

  it("changes the background hash when time, weather, or senses change", () => {
    const baseHash = computeBackgroundCardHash(schoolCard)
    const withTime = computeBackgroundCardHash({ ...schoolCard, time: "밤" })
    const withWeather = computeBackgroundCardHash({ ...schoolCard, weather: "비" })
    const withSenses = computeBackgroundCardHash({ ...schoolCard, senses: ["빗소리"] })

    expect(withTime).not.toBe(baseHash)
    expect(withWeather).not.toBe(baseHash)
    expect(withSenses).not.toBe(baseHash)
  })
})
