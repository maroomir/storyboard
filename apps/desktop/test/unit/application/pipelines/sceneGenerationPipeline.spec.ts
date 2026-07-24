import { describe, expect, it, vi } from "vitest"

import type { BackgroundCard, CharacterCard, SceneContext, SceneFile } from '@storyboard/story-format';
import {
  runSceneGenerationPipeline,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineStage
} from "@/application/pipelines/sceneGenerationPipeline"
import {
  chunkDialoguePiecesByBudget,
  dedupeSituations,
  looksLikeFormatMetaLeak,
  resolveSceneBreakJoiner
} from "@/application/pipelines/sceneGenerationPolicies"
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
      "[첫 번째 상황|prev=이전 씬 말미]",
      expect.objectContaining({
        attribution: {
          primary: { kind: "scene", id: "01-opening" },
          participants: [{ kind: "character", id: "elia" }]
        }
      })
    )

    const joined = "[첫 번째 상황|prev=이전 씬 말미]\n\n[두 번째 상황|prev=[첫 번째 상황|prev=이전 씬 말미]]"
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

  it("scopes personas to the characters listed in each situation", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([
      { characters: ["엘리아", "지훈"], situation: "둘 다" },
      { characters: ["엘리아"], situation: "엘리아만" }
    ])
    ai.createCharacterPersona.mockImplementation(async (character) => `페르소나:${character.name}`)
    ai.generatePersonaDialogue.mockResolvedValue("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const bothPersonas = ai.generatePersonaDialogue.mock.calls[0]?.[1] as Map<string, string>
    expect(Array.from(bothPersonas.keys())).toEqual(["엘리아", "지훈"])

    const scopedPersonas = ai.generatePersonaDialogue.mock.calls[1]?.[1] as Map<string, string>
    expect(scopedPersonas.size).toBe(1)
    expect(Array.from(scopedPersonas.keys())).toEqual(["엘리아"])
    expect(scopedPersonas.has("지훈")).toBe(false)
  })

  it("scopes personas by alias and keys the subset by the canonical name", async () => {
    const manjaeCard: CharacterCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      aliases: ["만재"]
    }

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["만재"], situation: "만재만" }])
    ai.createCharacterPersona.mockImplementation(async (character) => `페르소나:${character.name}`)
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([manjaeCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const personas = ai.generatePersonaDialogue.mock.calls[0]?.[1] as Map<string, string>
    expect(personas.size).toBe(1)
    expect(Array.from(personas.keys())).toEqual(["조만재"])
    expect(personas.has("만재")).toBe(false)
    expect(personas.has("지훈")).toBe(false)
  })

  it("passes the full personas map when a situation lists no characters", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: [], situation: "무명" }])
    ai.createCharacterPersona.mockImplementation(async (character) => `페르소나:${character.name}`)
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const personas = ai.generatePersonaDialogue.mock.calls[0]?.[1] as Map<string, string>
    expect(Array.from(personas.keys())).toEqual(["엘리아", "지훈"])
  })

  it("falls back to the full personas map when no listed name matches a persona", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["미등록"], situation: "미상" }])
    ai.createCharacterPersona.mockImplementation(async (character) => `페르소나:${character.name}`)
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const personas = ai.generatePersonaDialogue.mock.calls[0]?.[1] as Map<string, string>
    expect(Array.from(personas.keys())).toEqual(["엘리아", "지훈"])
  })

  it("chains generated dialogue, not raw situation text, into later previousContext", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([
      { characters: ["엘리아"], situation: "상황1" },
      { characters: ["엘리아"], situation: "상황2" },
      { characters: ["엘리아"], situation: "상황3" }
    ])
    ai.createCharacterPersona.mockResolvedValue("p")
    ai.generatePersonaDialogue.mockImplementation(async (situation) => `엘리아: ${situation}에서 만든 대사`)
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const thirdPriorContext = ai.generatePersonaDialogue.mock.calls[2]?.[3]
    expect(typeof thirdPriorContext).toBe("string")
    expect(thirdPriorContext as string).toContain("상황1에서 만든 대사")
    expect(thirdPriorContext as string).toContain("상황2에서 만든 대사")
    expect(thirdPriorContext).not.toBe("상황2")
    expect(thirdPriorContext as string).not.toContain("상황3")
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
      description: [],
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

  it("formats oversize dialogue in one chunk per piece and joins the parts", async () => {
    const progress: Array<{ readonly stage: SceneGenerationPipelineStage; readonly current: number; readonly total: number }> =
      []

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([
      { characters: ["엘리아"], situation: "상황1" },
      { characters: ["엘리아"], situation: "상황2" },
      { characters: ["엘리아"], situation: "상황3" }
    ])
    ai.createCharacterPersona.mockResolvedValue("p")
    ai.generatePersonaDialogue.mockImplementation(async (situation) => `${situation}|${"가".repeat(9000)}`)
    ai.applyGenreFormat.mockImplementation(async (dialogue) => `formatted(${dialogue.split("|")[0]})`)

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      onProgress: (stage, current, total) => {
        progress.push({ stage, current, total })
      }
    })

    expect(ai.applyGenreFormat).toHaveBeenCalledTimes(3)
    expect(progress.filter((entry) => entry.stage === "applyFormat")).toEqual([
      { stage: "applyFormat", current: 1, total: 3 },
      { stage: "applyFormat", current: 2, total: 3 },
      { stage: "applyFormat", current: 3, total: 3 }
    ])
    expect(result.draftBody).toBe("formatted(상황1)\n\nformatted(상황2)\n\nformatted(상황3)")
  })

  it("describes the background and injects the atmosphere into the dialogue background", async () => {
    const hallBackground: BackgroundCard = {
      type: "location",
      id: "school-hall",
      name: "복도",
      locationKind: "place",
      description: ["낡은 복도"],
      characterIds: [],
      tags: []
    }

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: [], situation: "복도" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.describeBackground.mockResolvedValueOnce("분필 냄새가 떠도는 오후의 정적")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문", hallBackground),
      aiService: ai,
      format: "novel"
    })

    expect(ai.describeBackground).toHaveBeenCalledWith(hallBackground, expect.anything())

    const dialogueBackground = ai.generatePersonaDialogue.mock.calls[0]?.[2] as BackgroundCard
    expect(dialogueBackground.description).toContain("낡은 복도")
    expect(dialogueBackground.description).toContain("분필 냄새가 떠도는 오후의 정적")
  })

  it("reuses a cached atmosphere from the background store", async () => {
    const hallBackground: BackgroundCard = {
      type: "location",
      id: "school-hall",
      name: "복도",
      locationKind: "place",
      description: ["낡은 복도"],
      characterIds: [],
      tags: []
    }

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: [], situation: "복도" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    const store = {
      load: vi.fn(async () => "캐시된 분위기"),
      save: vi.fn(async () => {})
    }

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문", hallBackground),
      aiService: ai,
      format: "novel",
      backgroundStore: store
    })

    expect(store.load).toHaveBeenCalledWith(hallBackground)
    expect(ai.describeBackground).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()

    const dialogueBackground = ai.generatePersonaDialogue.mock.calls[0]?.[2] as BackgroundCard
    expect(dialogueBackground.description).toContain("캐시된 분위기")
  })

  it("does not describe a background when the scene has none", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "단일" }])
    ai.createCharacterPersona.mockResolvedValueOnce("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.describeBackground).not.toHaveBeenCalled()
  })

  it("reuses a cached persona from the store instead of regenerating it", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "단일" }])
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    const store = {
      load: vi.fn(async () => "캐시된 페르소나"),
      save: vi.fn(async () => {})
    }

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      personaStore: store
    })

    expect(store.load).toHaveBeenCalledWith(eliaCard)
    expect(ai.createCharacterPersona).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(result.personasUsed.get("엘리아")).toBe("캐시된 페르소나")
  })

  it("generates and saves a persona when the store misses", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "단일" }])
    ai.createCharacterPersona.mockResolvedValueOnce("새 페르소나")
    ai.generatePersonaDialogue.mockResolvedValueOnce("d")
    ai.applyGenreFormat.mockResolvedValueOnce("out")

    const store = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async () => {})
    }

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      personaStore: store
    })

    expect(ai.createCharacterPersona).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledWith(eliaCard, "새 페르소나")
    expect(result.personasUsed.get("엘리아")).toBe("새 페르소나")
  })

  it("formats each situation separately and joins the parts with the scene break joiner", async () => {
    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([
      { characters: ["엘리아"], situation: "첫 번째 상황" },
      { characters: ["엘리아"], situation: "두 번째 상황" }
    ])
    ai.createCharacterPersona.mockResolvedValue("p")
    ai.generatePersonaDialogue.mockImplementation(async (situation) => `대사(${situation})`)
    ai.applyGenreFormat.mockImplementation(async (dialogue, format) => `<<${format}>>${dialogue}`)

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      sceneBreakJoiner: "\n\n---\n\n"
    })

    expect(ai.applyGenreFormat).toHaveBeenCalledTimes(2)
    expect(ai.applyGenreFormat).toHaveBeenNthCalledWith(1, "대사(첫 번째 상황)", "novel", expect.anything())
    expect(ai.applyGenreFormat).toHaveBeenNthCalledWith(2, "대사(두 번째 상황)", "novel", expect.anything())
    expect(result.draftBody).toBe("<<novel>>대사(첫 번째 상황)\n\n---\n\n<<novel>>대사(두 번째 상황)")
  })

  it("keeps the raw dialogue when the formatter leaks a meta message", async () => {
    const metaLeak = "분량 한계가 있어 한 번에 다 쓸 수 없습니다. 연재형과 압축형 중 어느 쪽을 원하시나요?"

    const ai = createRecordingAiService()
    ai.extractSituations.mockResolvedValueOnce([{ characters: ["엘리아"], situation: "상황1" }])
    ai.createCharacterPersona.mockResolvedValue("p")
    ai.generatePersonaDialogue.mockResolvedValueOnce("엘리아: 복도를 걷는 장면 대사")
    ai.applyGenreFormat.mockResolvedValueOnce(metaLeak)

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(result.draftBody).not.toContain(metaLeak)
    expect(result.draftBody).toBe("엘리아: 복도를 걷는 장면 대사")
  })
})

describe("chunkDialoguePiecesByBudget", () => {
  it("returns no chunks for an empty piece list", () => {
    expect(chunkDialoguePiecesByBudget([], 8000)).toEqual([])
  })

  it("packs pieces that fit within the budget into a single chunk", () => {
    expect(chunkDialoguePiecesByBudget(["a", "bb", "ccc"], 8000)).toEqual([["a", "bb", "ccc"]])
  })

  it("splits at the boundary where the cumulative length would exceed the budget", () => {
    expect(chunkDialoguePiecesByBudget(["aaaa", "bbbb", "cc", "dddd"], 8)).toEqual([
      ["aaaa", "bbbb"],
      ["cc", "dddd"]
    ])
  })

  it("makes a single oversize piece its own chunk", () => {
    expect(chunkDialoguePiecesByBudget(["aa", "bbbbbb", "cc"], 4)).toEqual([["aa"], ["bbbbbb"], ["cc"]])
  })

  it("preserves the original order across chunks", () => {
    const pieces = ["1", "2", "3", "4", "5"]
    expect(chunkDialoguePiecesByBudget(pieces, 2).flat()).toEqual(pieces)
  })
})

describe("resolveSceneBreakJoiner", () => {
  it("wraps a textual separator with blank lines", () => {
    expect(resolveSceneBreakJoiner("---")).toBe("\n\n---\n\n")
    expect(resolveSceneBreakJoiner("* * *")).toBe("\n\n* * *\n\n")
  })

  it("converts a numeric separator into that many newlines", () => {
    expect(resolveSceneBreakJoiner("3")).toBe("\n\n\n")
    expect(resolveSceneBreakJoiner(" 2 ")).toBe("\n\n")
  })

  it("caps the newline count at 10", () => {
    expect(resolveSceneBreakJoiner("999")).toBe("\n".repeat(10))
  })

  it("returns undefined for zero newlines", () => {
    expect(resolveSceneBreakJoiner("0")).toBeUndefined()
  })

  it("returns undefined for blank or missing separators", () => {
    expect(resolveSceneBreakJoiner("")).toBeUndefined()
    expect(resolveSceneBreakJoiner("   ")).toBeUndefined()
    expect(resolveSceneBreakJoiner(undefined)).toBeUndefined()
  })
})

describe("looksLikeFormatMetaLeak", () => {
  it("flags text that has both a length excuse and an options offer", () => {
    expect(
      looksLikeFormatMetaLeak("분량 한계가 있어 한 번에 다 쓸 수 없습니다. 연재형과 압축형 중 어느 쪽을 원하시나요?")
    ).toBe(true)
  })

  it("does not flag normal prose", () => {
    expect(looksLikeFormatMetaLeak("엘리아는 복도를 걸으며 창밖을 바라보았다.")).toBe(false)
  })

  it("does not flag text with only a length excuse", () => {
    expect(looksLikeFormatMetaLeak("분량 한계가 있어 한 번에 다 쓸 수 없습니다.")).toBe(false)
  })

  it("does not flag text with only an options offer", () => {
    expect(looksLikeFormatMetaLeak("연재형과 압축형 중 어느 쪽을 원하시나요?")).toBe(false)
  })
})

function createRecordingAiService(): SceneGenerationPipelineAiService & {
  readonly extractSituations: ReturnType<typeof vi.fn>
  readonly createCharacterPersona: ReturnType<typeof vi.fn>
  readonly describeBackground: ReturnType<typeof vi.fn>
  readonly generatePersonaDialogue: ReturnType<typeof vi.fn>
  readonly applyGenreFormat: ReturnType<typeof vi.fn>
} {
  return {
    extractSituations: vi.fn(async () => []),
    createCharacterPersona: vi.fn(async () => ""),
    describeBackground: vi.fn(async () => ""),
    generatePersonaDialogue: vi.fn(async () => ""),
    applyGenreFormat: vi.fn(async () => "")
  }
}
