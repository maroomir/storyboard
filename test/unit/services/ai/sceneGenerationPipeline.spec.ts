import { describe, expect, it, vi } from "vitest"

import type { SceneContext } from "@/core/sceneContext"
import {
  dedupeSituations,
  runSceneGenerationPipeline,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineStage
} from "@/services/ai/pipelines/sceneGenerationPipeline"
import type { SceneFile } from "@/shared/scene"
import type { BackgroundCard, CharacterCard } from "@/shared/card"

const eliaCard: CharacterCard = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main"
}

const jihoonCard: CharacterCard = {
  type: "character",
  id: "jihoon",
  name: "지훈",
  role: "main"
}

function sceneFile(body: string): SceneFile {
  return {
    stem: "01-opening",
    order: 1,
    orderText: "01",
    slug: "opening",
    frontmatter: {},
    body
  }
}

function contextFor(characters: readonly CharacterCard[], body: string, background?: BackgroundCard): SceneContext {
  return {
    scene: sceneFile(body),
    characters,
    background
  }
}

describe("runSceneGenerationPipeline", () => {
  it("rejects an empty scene body", async () => {
    const ai = createRecordingAiService()
    await expect(
      runSceneGenerationPipeline({
        sceneStem: "01-opening",
        context: contextFor([eliaCard], "   \n  "),
        aiService: ai,
        format: "novel"
      })
    ).rejects.toThrow(/씬 본문이 비어 있습니다/)

    expect(ai.extractSituations).not.toHaveBeenCalled()
  })

  it("rejects when no characters are in context", async () => {
    const ai = createRecordingAiService()
    await expect(
      runSceneGenerationPipeline({
        sceneStem: "01-opening",
        context: contextFor([], "엘리아가 걷는다."),
        aiService: ai,
        format: "novel"
      })
    ).rejects.toThrow(/등장인물을 찾을 수 없습니다/)

    expect(ai.extractSituations).not.toHaveBeenCalled()
  })

  it("rejects when situations are empty after dedupe", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([])

    await expect(
      runSceneGenerationPipeline({
        sceneStem: "01-opening",
        context: contextFor([eliaCard], "본문"),
        aiService: ai,
        format: "novel"
      })
    ).rejects.toThrow(/상황을 추출할 수 없습니다/)
  })

  it("dedupes situations like Picktion (trim, lowercase, collapse spaces)", () => {
    const raw = [
      { characters: ["엘리아"], situation: "  교실에서 대화  " },
      { characters: ["엘리아"], situation: "교실에서\n대화" },
      { characters: ["지훈"], situation: "복도에서 달린다" }
    ]
    expect(dedupeSituations(raw)).toEqual([
      { characters: ["엘리아"], situation: "  교실에서 대화  " },
      { characters: ["지훈"], situation: "복도에서 달린다" }
    ])
  })

  it("runs stages in order, joins dialogues, then formats once", async () => {
    const progress: Array<{ readonly stage: SceneGenerationPipelineStage; readonly current: number; readonly total: number }> =
      []

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([
      { characters: ["엘리아", "지훈"], situation: "첫 번째 상황" },
      { characters: ["엘리아"], situation: "두 번째 상황" }
    ])
    ai.createCharacterPersona.mockImplementation(async (character) => `페르소나:${character.name}`)
    ai.generatePersonaDialogue.mockImplementation(async (situation, _personas, _background, previousContext) => {
      const prev = previousContext ?? "none"
      return `[${situation}|prev=${prev}]`
    })
    ai.applyGenreFormat.mockImplementation(async (dialogue, format) => `<<${format}>>${dialogue}`)

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "엘리아와 지훈이 학교에 있다."),
      aiService: ai,
      format: "screenplay",
      previousContext: "이전 씬 말미",
      providers: { situationExtraction: "mock", personaGeneration: "google", sceneDraft: "openai" },
      onProgress: (stage, current, total) => {
        progress.push({ stage, current, total })
      }
    })

    expect(progress).toEqual([
      { stage: "extractSituations", current: 1, total: 1 },
      { stage: "buildPersonas", current: 1, total: 2 },
      { stage: "buildPersonas", current: 2, total: 2 },
      { stage: "generateDialogue", current: 1, total: 2 },
      { stage: "generateDialogue", current: 2, total: 2 },
      { stage: "applyFormat", current: 1, total: 1 }
    ])

    expect(ai.generatePersonaDialogue).toHaveBeenNthCalledWith(
      1,
      "첫 번째 상황",
      expect.any(Map),
      expect.anything(),
      "이전 씬 말미",
      expect.objectContaining({
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [
            { kind: "character", id: "elia" },
            { kind: "character", id: "jihoon" }
          ]
        }
      })
    )
    expect(ai.generatePersonaDialogue).toHaveBeenNthCalledWith(
      2,
      "두 번째 상황",
      expect.any(Map),
      expect.anything(),
      "첫 번째 상황",
      expect.objectContaining({
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [{ kind: "character", id: "elia" }]
        }
      })
    )

    const joined = "[첫 번째 상황|prev=이전 씬 말미]\n\n[두 번째 상황|prev=첫 번째 상황]"
    expect(ai.applyGenreFormat).toHaveBeenCalledWith(
      joined,
      "screenplay",
      expect.objectContaining({
        providerId: "openai",
        attribution: { primary: { kind: "scene", id: "01-opening" } }
      })
    )

    expect(result.draftBody).toBe(`<<screenplay>>${joined}`)
    expect(result.detectedCharacters).toEqual(["엘리아", "지훈"])
    expect(result.situations).toHaveLength(2)
    expect(result.personasUsed.get("엘리아")).toBe("페르소나:엘리아")
    expect(result.personasUsed.get("지훈")).toBe("페르소나:지훈")
    expect(result.providers).toEqual({
      situationExtraction: "mock",
      personaGeneration: "google",
      sceneDraft: "openai"
    })
  })

  it("condenses previousContext when context condense is enabled", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "첫 번째 상황" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    const longContext = `엘리아: 시작\n${"지문\n".repeat(800)}끝`

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      previousContext: longContext,
      useContextCondense: true
    })

    const previous = ai.generatePersonaDialogue.mock.calls[0]?.[3]
    expect(typeof previous).toBe("string")
    expect((previous as string).length).toBeLessThanOrEqual(1200)
  })

  it("passes provider override for extraction and persona steps", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "단일" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      providers: {
        situationExtraction: "claude",
        personaGeneration: "google",
        personaDialogue: "openai",
        sceneDraft: "ollama"
      }
    })

    expect(ai.extractSituations).toHaveBeenCalledWith(
      "본문",
      expect.objectContaining({
        providerId: "claude",
        attribution: { primary: { kind: "scene", id: "01-opening" } }
      })
    )
    expect(ai.createCharacterPersona).toHaveBeenCalledWith(
      eliaCard,
      expect.objectContaining({
        providerId: "google",
        attribution: {
          primary: { kind: "character", id: "elia" },
          participants: [{ kind: "scene", id: "01-opening" }]
        }
      })
    )
    expect(ai.generatePersonaDialogue).toHaveBeenCalledWith(
      "단일",
      expect.any(Map),
      expect.anything(),
      undefined,
      expect.objectContaining({
        providerId: "openai",
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [{ kind: "character", id: "elia" }]
        }
      })
    )
    expect(ai.applyGenreFormat).toHaveBeenCalledWith(
      "d",
      "novel",
      expect.objectContaining({
        providerId: "ollama",
        attribution: { primary: { kind: "scene", id: "01-opening" } }
      })
    )
  })

  it("falls back to all context characters when situation lists no characters", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: [], situation: "무명 상황" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p1")
    ai.createCharacterPersona.mockResolvedValueOnce("p2")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.generatePersonaDialogue).toHaveBeenCalledWith(
      "무명 상황",
      expect.any(Map),
      expect.anything(),
      undefined,
      expect.objectContaining({
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [
            { kind: "character", id: "elia" },
            { kind: "character", id: "jihoon" }
          ]
        }
      })
    )
  })

  it("adds background to dialogue participants when situation lists no characters", async () => {
    const hallBackground: BackgroundCard = {
      type: "location",
      id: "school-hall",
      name: "복도",
      locationKind: "place",
      description: "",
      characterIds: [],
      tags: []
    }

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: [], situation: "복도" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문", hallBackground),
      aiService: ai,
      format: "novel"
    })

    expect(ai.generatePersonaDialogue).toHaveBeenCalledWith(
      "복도",
      expect.any(Map),
      expect.anything(),
      undefined,
      expect.objectContaining({
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [
            { kind: "character", id: "elia" },
            { kind: "background", id: "school-hall" }
          ]
        }
      })
    )
  })
})

function createRecordingAiService(): SceneGenerationPipelineAiService & {
  readonly extractSituations: ReturnType<typeof vi.fn>
  readonly createCharacterPersona: ReturnType<typeof vi.fn>
  readonly generatePersonaDialogue: ReturnType<typeof vi.fn>
  readonly applyGenreFormat: ReturnType<typeof vi.fn>
} {
  return {
    extractSituations: vi.fn(async () => []),
    createCharacterPersona: vi.fn(async () => ""),
    generatePersonaDialogue: vi.fn(async () => ""),
    applyGenreFormat: vi.fn(async () => "")
  }
}
