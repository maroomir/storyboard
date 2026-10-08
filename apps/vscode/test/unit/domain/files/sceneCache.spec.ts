import { describe, expect, it } from "vitest"

import {
  parseScene,
  computeSceneInputHash,
  parseSceneCache,
  sceneNarrationHashInput,
  serializeSceneCache,
  type SceneCacheRecord,
} from '@storyboard/story-model';
import type { BackgroundCard, CharacterCard } from '@storyboard/story-model';

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

  it("changes the hash when catchphrases are added and keeps it for a card without them", () => {
    const input = {
      sceneBody: "같은 입력",
      characters: [sampleCharacter],
      background: sampleBackground,
      format: "novel"
    } as const
    const baseHash = computeSceneInputHash(input)
    const withCatchphrases = computeSceneInputHash({
      ...input,
      characters: [{ ...sampleCharacter, catchphrases: ["뭐 별거는 아닌데"] }]
    })
    const withEmptyCatchphrases = computeSceneInputHash({
      ...input,
      characters: [{ ...sampleCharacter, catchphrases: [] }]
    })

    expect(withCatchphrases).not.toBe(baseHash)
    expect(withEmptyCatchphrases).toBe(baseHash)
  })

  it("changes the hash when a relation speech is set and keeps it for relations without one", () => {
    const input = {
      sceneBody: "같은 입력",
      characters: [{ ...sampleCharacter, relations: [{ target: "jun", type: "친구" }] }],
      background: sampleBackground,
      format: "novel"
    } as const
    const baseHash = computeSceneInputHash(input)
    const withSpeech = computeSceneInputHash({
      ...input,
      characters: [{ ...sampleCharacter, relations: [{ target: "jun", type: "친구", speech: "존댓말" }] }]
    })

    expect(withSpeech).not.toBe(baseHash)
    expect(computeSceneInputHash({ ...input, characters: [sampleCharacter] })).toBe(baseHash)
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

describe("scene input hash: narration fields", () => {
  const base = {
    sceneBody: "샘플 캐릭터가 등장한다.",
    characters: [sampleCharacter],
    background: sampleBackground,
    format: "novel" as const
  }

  // NOTE: narrator·thread·povCharacter 는 프롬프트를 바꾼다. digest 에 없으면 시점을 바꾼 뒤
  // `draft generate` 가 캐시를 맞다고 판단해 옛 시점의 초안을 그대로 내놓는다.
  it("changes the hash when the scene names a different narrator", () => {
    const before = computeSceneInputHash({ ...base, narration: { narrator: "hana-first" } })
    const after = computeSceneInputHash({ ...base, narration: { narrator: "wide" } })

    expect(after).not.toBe(before)
  })

  it("changes the hash when the scene moves to another thread", () => {
    const before = computeSceneInputHash({ ...base, narration: { thread: "ep1" } })
    const after = computeSceneInputHash({ ...base, narration: { thread: "ep2" } })

    expect(after).not.toBe(before)
  })

  it("changes the hash when the focal character changes", () => {
    const before = computeSceneInputHash({ ...base, narration: { povCharacter: "hana" } })
    const after = computeSceneInputHash({ ...base, narration: { povCharacter: "jun" } })

    expect(after).not.toBe(before)
  })

  // 이 필드를 쓰지 않는 기존 워크스페이스의 해시는 그대로여야 한다. 바뀌면 업그레이드만으로
  // 고치지 않은 씬까지 전부 다시 생성된다.
  it("keeps the pre-narration hash when the scene uses none of the fields", () => {
    const legacy = computeSceneInputHash(base)

    expect(computeSceneInputHash({ ...base, narration: undefined })).toBe(legacy)
    expect(computeSceneInputHash({ ...base, narration: {} })).toBe(legacy)
  })

  it("derives the digest input from the scene card and frontmatter", () => {
    const scene = parseScene(
      "type: scene\nid: 01-dock\nnarrator: hana-first\nthread: ep2\npovCharacter: hana\nsummary: 사건.\n",
      "01-dock.card"
    )

    expect(sceneNarrationHashInput(scene)).toEqual({
      narrator: "hana-first",
      thread: "ep2",
      povCharacter: "hana"
    })
  })

  it("reports nothing to digest for a scene that steers no narration", () => {
    const scene = parseScene("type: scene\nid: 01-dock\nsummary: 사건.\n", "01-dock.card")

    expect(sceneNarrationHashInput(scene)).toBeUndefined()
  })
})

