import { describe, expect, it, vi } from "vitest"

import type { SceneContext } from "../../../../src/core/sceneContext"
import {
  dedupeSituations,
  runSceneGenerationPipeline,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineStage
} from "../../../../src/services/ai/pipelines/sceneGenerationPipeline"
import type { SceneFile } from "../../../../src/shared/scene"
import type { CharacterCard } from "../../../../src/shared/card"

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

function contextFor(characters: readonly CharacterCard[], body: string): SceneContext {
  return {
    scene: sceneFile(body),
    characters,
    background: undefined
  }
}

describe("runSceneGenerationPipeline", () => {
  it("rejects an empty scene body", async () => {
    const ai = createRecordingAiService()
    await expect(
      runSceneGenerationPipeline({
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
      context: contextFor([eliaCard, jihoonCard], "엘리아와 지훈이 학교에 있다."),
      aiService: ai,
      format: "screenplay",
      previousContext: "이전 씬 말미",
      providers: { situationExtraction: "mock", sceneDraft: "openai" },
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
      undefined
    )
    expect(ai.generatePersonaDialogue).toHaveBeenNthCalledWith(
      2,
      "두 번째 상황",
      expect.any(Map),
      expect.anything(),
      "첫 번째 상황",
      undefined
    )

    const joined = "[첫 번째 상황|prev=이전 씬 말미]\n\n[두 번째 상황|prev=첫 번째 상황]"
    expect(ai.applyGenreFormat).toHaveBeenCalledWith(
      joined,
      "screenplay",
      expect.objectContaining({ providerId: "openai" })
    )

    expect(result.draftBody).toBe(`<<screenplay>>${joined}`)
    expect(result.detectedCharacters).toEqual(["엘리아", "지훈"])
    expect(result.situations).toHaveLength(2)
    expect(result.personasUsed.get("엘리아")).toBe("페르소나:엘리아")
    expect(result.personasUsed.get("지훈")).toBe("페르소나:지훈")
    expect(result.providers).toEqual({ situationExtraction: "mock", sceneDraft: "openai" })
  })

  it("passes provider override for extraction and persona steps", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "단일" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      providers: { situationExtraction: "claude", personaDialogue: "google", sceneDraft: "ollama" }
    })

    expect(ai.extractSituations).toHaveBeenCalledWith("본문", { providerId: "claude" })
    expect(ai.createCharacterPersona).toHaveBeenCalledWith(eliaCard, { providerId: "google" })
    expect(ai.generatePersonaDialogue).toHaveBeenCalledWith(
      "단일",
      expect.any(Map),
      expect.anything(),
      undefined,
      { providerId: "google" }
    )
    expect(ai.applyGenreFormat).toHaveBeenCalledWith("d", "novel", { providerId: "ollama" })
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
