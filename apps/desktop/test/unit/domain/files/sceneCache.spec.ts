import { describe, expect, it } from "vitest"

import type { BackgroundCard, CharacterCard } from '@storyboard/story-format';
import {
  computeSceneInputHash,
  parseSceneCache,
  serializeSceneCache,
  type SceneCacheRecord
} from "@/domain/files/sceneCache"

const sampleCharacter: CharacterCard = {
  type: "character",
  id: "sample",
  name: "샘플 캐릭터",
  role: "main",
  traits: ["호기심이 많음"],
  tags: ["샘플"],
  description: ["테스트 캐릭터"],
  recentDialogues: ["시작해볼까?"]
}

const sampleBackground: BackgroundCard = {
  type: "location",
  id: "sample",
  name: "샘플 배경",
  locationKind: "place",
  characterIds: [],
  tags: ["샘플"],
  description: ["테스트 배경"]
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
      skeleton: "샘플 캐릭터가 등장한다.",
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

  it("changes the hash when character desire or background atmosphere change", () => {
    const baseHash = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const withDesire = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [{ ...sampleCharacter, desire: ["목표가 생겼다"] }],
      background: sampleBackground,
      format: "novel"
    })
    const withAtmosphere = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: { ...sampleBackground, time: "밤", weather: "비", senses: ["빗소리"] },
      format: "novel"
    })

    expect(withDesire).not.toBe(baseHash)
    expect(withAtmosphere).not.toBe(baseHash)
  })

  it("changes the hash when character voice or attributes change", () => {
    const baseHash = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const withVoice = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [{ ...sampleCharacter, voice: ["거친 말투"] }],
      background: sampleBackground,
      format: "novel"
    })
    const withAttributes = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [{ ...sampleCharacter, attributes: { mbti: "ENFJ" } }],
      background: sampleBackground,
      format: "novel"
    })

    expect(withVoice).not.toBe(baseHash)
    expect(withAttributes).not.toBe(baseHash)
  })

  it("changes the hash when bible facts are injected", () => {
    const withoutFacts = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const withFacts = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel",
      bibleFacts: [
        { id: "f1", subject: { kind: "character", id: "sample" }, key: "눈동자 색", value: "녹색", status: "canon" }
      ]
    })

    expect(withFacts).not.toBe(withoutFacts)
    expect(withFacts).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it("keeps the hash unchanged without a scene break joiner and changes it when one is set", () => {
    const withoutJoiner = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    })
    const withUndefinedJoiner = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel",
      sceneBreakJoiner: undefined
    })
    const withJoiner = computeSceneInputHash({
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel",
      sceneBreakJoiner: "\n\n---\n\n"
    })

    expect(withUndefinedJoiner).toBe(withoutJoiner)
    expect(withJoiner).not.toBe(withoutJoiner)
  })
})