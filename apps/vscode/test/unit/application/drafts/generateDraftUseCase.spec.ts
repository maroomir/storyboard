import { stubFileSystem } from "../../../stubs/fileSystem"
import { stubScenes, type StubSceneStates } from "../../../stubs/scenes"
import { stubCards } from "../../../stubs/cards"
import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  joinStoryPath,
  draftPath,
  computeSceneInputHash,
  computeDraftBodyHash,
  createDraft,
  parseDraft,
  serializeDraft,
} from "@storyboard/story-model"
import { workspace, type WorkspaceFolder } from "../../../stubs/vscode"

const buildSceneContextMock = vi.fn()
const buildNarrativeContextMock = vi.fn()
const uriExistsMock = vi.fn()
const archiveExistingDraftMock = vi.fn()
const pipelineRunMock = vi.fn()

vi.mock("@storyboard/story-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-model")>())
}))
vi.mock("../../../../../../packages/story-engine/src/persistence/sceneContextReader", () => ({
  SceneContextReader: class {
    public build(...args: unknown[]): unknown {
      return ((...args: unknown[]): unknown => buildSceneContextMock(...args))(...args)
    }
    public buildNarrative(...args: unknown[]): unknown {
      return ((...args: unknown[]): unknown => buildNarrativeContextMock(...args))(...args)
    }
  }
}))
vi.mock("../../../../../../packages/story-model/src/domain/files/draftHistory", async (
  importOriginal
) => ({
  ...(await importOriginal<
    typeof import("../../../../../../packages/story-model/src/domain/files/draftHistory")
  >()),
  archiveExistingDraft: (...args: unknown[]): unknown => archiveExistingDraftMock(...args)
}))
vi.mock('../../../../../../packages/story-engine/src/pipeline/scene/sceneGenerationPipeline', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../../../packages/story-engine/src/pipeline/scene/sceneGenerationPipeline')
  >('../../../../../../packages/story-engine/src/pipeline/scene/sceneGenerationPipeline')
  return {
    ...actual,
    SceneGenerationPipeline: class {
      public constructor(public readonly input: unknown) {}
      public run(): unknown {
        return pipelineRunMock(this.input)
      }
    }
  }
})

import {
  GenerateDraftUseCase,
  type AiServices,
  type GenerateDraftRequest,
  type GenerateDraftResult,
  type HostAdapters,
  type WorkspaceRepositories,
  SceneGenerationPipelineCancelledError,
} from "@storyboard/story-engine"
import { createTestAi, createTestHost, createTestRepositories } from "@storyboard/story-engine/testing"

const workspaceRoot = vscode.Uri.file("/ws")

interface GenerateDraftServices {
  readonly host: HostAdapters
  readonly ai: AiServices
  readonly repositories: WorkspaceRepositories
}
const sceneUri = vscode.Uri.file("/ws/scene/01-intro.card")
const workspaceFolder: WorkspaceFolder = { uri: workspaceRoot as never, name: "ws", index: 0 }

const fakeScene = {
  stem: "01-intro",
  order: 1,
  orderText: "01",
  slug: "intro",
  card: { type: "scene", id: "01-intro" },
  frontmatter: {},
  body: "씬 본문"
}

const fakeProject = {
  version: "1.0.0",
  id: "p1",
  name: "테스트",
  format: "novel",
  language: "ko",
  createdAt: new Date().toISOString(),
  editor: {}
}

const primaryCharacterCard = { type: "character", id: "juseo", name: "준서", role: "main" }
const secondaryCharacterCard = { type: "character", id: "hana", name: "하나", role: "supporting" }
const sceneBackgroundCard = {
  type: "location",
  id: "cafe",
  name: "카페",
  description: [],
  characterIds: [],
  tags: [],
}

const aiServiceStub = {
  marker: "ai-service",
  proposeSceneBeats: vi.fn(async () => [
    { text: "첫 비트", cast: [] },
    { text: "둘째 비트", cast: [] }
  ])
}

const pipelineSuccessResult = {
  draftBody: "생성된 초안 본문",
  detectedCharacters: ["준서"],
  sceneCoordinates: [] as readonly string[],
  situations: [],
  personasUsed: new Map<string, string>(),
  warnings: [] as readonly string[],
  providers: {}
}

function sceneContext(overrides: Record<string, unknown> = {}): unknown {
  return {
    scene: fakeScene,
    characters: [primaryCharacterCard, secondaryCharacterCard],
    background: sceneBackgroundCard,
    ...overrides
  }
}

interface LoggerSpy {
  readonly info: ReturnType<typeof vi.fn>
  readonly warn: ReturnType<typeof vi.fn>
  readonly error: ReturnType<typeof vi.fn>
  readonly show: ReturnType<typeof vi.fn>
  readonly dispose: ReturnType<typeof vi.fn>
}

function createLogger(): LoggerSpy {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn() }
}

interface ConfigBridgeStub {
  readonly getDraftSceneBreakSeparator: () => string | undefined
  readonly isAutoBeatsEnabled: () => boolean
  readonly getCharsPerBeat: () => number
  readonly getMinBeats: () => number
  readonly isAiContextCondenseEnabled: () => boolean
  readonly getSectionOutputLimit: () => number
  readonly getSceneGenerationTuning: () => Record<string, number>
}

function createConfigBridge(overrides: Partial<ConfigBridgeStub> = {}): ConfigBridgeStub {
  return {
    getDraftSceneBreakSeparator: () => undefined,
    isAutoBeatsEnabled: () => false,
    getCharsPerBeat: () => 1500,
    getMinBeats: () => 5,
    isAiContextCondenseEnabled: () => false,
    getSectionOutputLimit: () => 7000,
    getSceneGenerationTuning: () => ({}),
    ...overrides
  }
}

interface DraftRepositoryStub {
  readonly write: ReturnType<typeof vi.fn>
}

function createDraftRepository(overrides: Partial<DraftRepositoryStub> = {}): DraftRepositoryStub {
  return { write: vi.fn(async () => undefined), ...overrides }
}

interface SceneCacheRepositoryStub {
  readonly read: ReturnType<typeof vi.fn>
  readonly write: ReturnType<typeof vi.fn>
  readonly ensureDirectory: ReturnType<typeof vi.fn>
}

function createSceneCacheRepository(
  overrides: Partial<SceneCacheRepositoryStub> = {}
): SceneCacheRepositoryStub {
  return {
    read: vi.fn(async () => {
      throw new Error("sceneCacheRepository.read was not stubbed for this test")
    }),
    write: vi.fn(async () => undefined),
    ensureDirectory: vi.fn(async () => undefined),
    ...overrides
  }
}

interface DependencyOverrides {
  readonly configBridge?: ConfigBridgeStub
  readonly draftRepository?: DraftRepositoryStub
  readonly logger?: LoggerSpy
  readonly sceneCacheRepository?: SceneCacheRepositoryStub
  readonly writeBeats?: ReturnType<typeof vi.fn>
  readonly sceneRepository?: unknown
  readonly sceneStates?: StubSceneStates
}

function createDependencies(overrides: DependencyOverrides = {}): GenerateDraftServices {
  return {
    host: createTestHost({
      configBridge: overrides.configBridge ?? createConfigBridge(),
      fileSystem: overrides.fileSystem ?? { ...stubFileSystem, exists: uriExistsMock },
      generator: "storyboard@0.0.0-test",
      logger: overrides.logger ?? createLogger(),
      scenes: stubScenes([fakeScene], undefined, overrides.sceneStates),
      cards: stubCards(),
      workspaceLocator: {
        folders: () => workspace.workspaceFolders ?? [],
        folderFor: (uri: never) => workspace.getWorkspaceFolder(uri)
      }
    } as never),
    ai: createTestAi({
      gateway: {
        createService: () => aiServiceStub,
        getTaskProvider: (task: string) => `provider:${task}`,
        getTaskAiConfig: (task: string) => ({ providerId: `provider:${task}`, model: `model:${task}` })
      } as never
    }),
    repositories: createTestRepositories({
      drafts: overrides.draftRepository ?? createDraftRepository(),
      project: { read: vi.fn(async () => fakeProject) },
      chapterSummaries: { hasChapterPlan: vi.fn(async () => false) },
      sceneCache: overrides.sceneCacheRepository ?? createSceneCacheRepository(),
      scenes: overrides.sceneRepository ?? {
        read: vi.fn(async () => fakeScene),
        writeBeats: overrides.writeBeats ?? vi.fn(async () => undefined)
      }
    } as never)
  }
}

function withFileSystem(dependencies: GenerateDraftServices, fileSystem: unknown): GenerateDraftServices {
  return { ...dependencies, host: createTestHost({ ...dependencies.host, fileSystem: fileSystem as never }) }
}

const ourDraftBody = pipelineSuccessResult.draftBody
const ourDraftBodyHash = computeDraftBodyHash(
  parseDraft(serializeDraft(createDraft({ sceneStem: fakeScene.stem, format: "novel", body: ourDraftBody }))).body
)

function ourDraftFileSystem(): IFileSystem {
  const serialized = serializeDraft(
    createDraft({ sceneStem: fakeScene.stem, format: "novel", body: ourDraftBody })
  )
  return {
    ...stubFileSystem,
    exists: uriExistsMock,
    readFile: async (): Promise<Uint8Array> => new TextEncoder().encode(serialized)
  }
}

function createRequest(overrides: Partial<GenerateDraftRequest> = {}): GenerateDraftRequest {
  return { force: false, ...overrides }
}

async function execute(
  dependencies: GenerateDraftServices,
  request: GenerateDraftRequest
): Promise<GenerateDraftResult> {
  return await new GenerateDraftUseCase(dependencies.host, dependencies.ai, dependencies.repositories).execute({
    ...request,
    sceneUri
  })
}

describe("GenerateDraftUseCase", () => {
  beforeEach(() => {
    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined

    buildSceneContextMock.mockReset().mockResolvedValue(sceneContext())
    buildNarrativeContextMock.mockReset().mockResolvedValue({ prompt: undefined, bibleFacts: [] })
    uriExistsMock.mockReset().mockResolvedValue(true)
    archiveExistingDraftMock.mockReset().mockResolvedValue(undefined)
    pipelineRunMock.mockReset().mockResolvedValue(pipelineSuccessResult)
    aiServiceStub.proposeSceneBeats.mockClear()
  })

  describe("empty generation", () => {
    it.each(["", "  \n\n  "])("refuses to save a draft whose body is %j and keeps the old one", async (draftBody) => {
      pipelineRunMock.mockResolvedValue({ ...pipelineSuccessResult, draftBody })
      const sceneCacheRepository = createSceneCacheRepository()
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ sceneCacheRepository, draftRepository })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toMatchObject({ ok: false, kind: "failed" })
      expect((result as { message: string }).message).toContain("빈 본문")
      expect(draftRepository.write).not.toHaveBeenCalled()
      expect(sceneCacheRepository.write).not.toHaveBeenCalled()
      expect(archiveExistingDraftMock).not.toHaveBeenCalled()
    })
  })

  describe("cache hit and force", () => {
    it("returns the cached draft without invoking the generation pipeline when the input hash matches", async () => {
      const matchingHash = computeSceneInputHash({
        sceneBody: fakeScene.body,
        characters: [primaryCharacterCard, secondaryCharacterCard] as never,
        background: sceneBackgroundCard as never,
        format: fakeProject.format as never,
        bibleFacts: [],
        sceneBreakJoiner: undefined,
        grounding: { place: "카페" }
      })
      const sceneCacheRepository = createSceneCacheRepository({
        read: vi.fn(async () => ({ inputHash: matchingHash }))
      })
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ sceneCacheRepository, draftRepository })

      const result = await execute(dependencies, createRequest({ force: false }))

      expect(result).toEqual({
        ok: true,
        kind: "cache_hit",
        draftUri: draftPath(workspaceRoot, fakeScene.stem)
      })
      expect(pipelineRunMock).not.toHaveBeenCalled()
      expect(draftRepository.write).not.toHaveBeenCalled()
      expect(sceneCacheRepository.write).not.toHaveBeenCalled()
    })

    describe("without a scene cache", () => {
      const groundedHash = computeSceneInputHash({
        sceneBody: fakeScene.body,
        characters: [primaryCharacterCard, secondaryCharacterCard] as never,
        background: sceneBackgroundCard as never,
        format: fakeProject.format as never,
        bibleFacts: [],
        sceneBreakJoiner: undefined,
        grounding: { place: "카페" }
      })

      const clonedWorkspaceFileSystem: IFileSystem = {
        ...stubFileSystem,
        exists: async (uri) => !uri.path.includes("/.storyboard/cache/")
      }

      function ledgerRecording(inputHash: string): StubSceneStates {
        return new Map([[fakeScene.stem, { inputHash, statements: [] }]])
      }

      it("keeps the draft when the ledger recorded the same input hash", async () => {
        const sceneCacheRepository = createSceneCacheRepository()
        const draftRepository = createDraftRepository()
        const dependencies = createDependencies({
          sceneCacheRepository,
          draftRepository,
          fileSystem: clonedWorkspaceFileSystem,
          sceneStates: ledgerRecording(groundedHash)
        })

        const result = await execute(dependencies, createRequest({ force: false }))

        expect(result).toMatchObject({ ok: true, kind: "cache_hit" })
        expect(pipelineRunMock).not.toHaveBeenCalled()
        expect(draftRepository.write).not.toHaveBeenCalled()
      })

      it("regenerates when the ledger recorded a different input hash", async () => {
        const dependencies = createDependencies({
          fileSystem: clonedWorkspaceFileSystem,
          sceneStates: ledgerRecording(`sha256:${"0".repeat(64)}`)
        })

        const result = await execute(dependencies, createRequest({ force: false }))

        expect(result).toMatchObject({ ok: true, kind: "generated" })
        expect(pipelineRunMock).toHaveBeenCalledTimes(1)
      })
    })

    it("bypasses the cache hit shortcut and regenerates when force is true", async () => {
      const sceneCacheRepository = createSceneCacheRepository()
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ sceneCacheRepository, draftRepository })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toMatchObject({ ok: true, kind: "generated" })
      expect(pipelineRunMock).toHaveBeenCalledTimes(1)
      expect(draftRepository.write).toHaveBeenCalledTimes(1)
      expect(draftRepository.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          generator: "storyboard@0.0.0-test",
          providerId: "provider:sceneDraft",
          model: "model:sceneDraft"
        })
      )
      expect(sceneCacheRepository.write).toHaveBeenCalledTimes(1)
    })
  })

  describe("pipeline cancellation", () => {
    it("surfaces SceneGenerationPipelineCancelledError as a cancelled result without logging or writing", async () => {
      pipelineRunMock.mockRejectedValueOnce(new SceneGenerationPipelineCancelledError())
      const logger = createLogger()
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ logger, draftRepository })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toEqual({ ok: false, kind: "cancelled" })
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.show).not.toHaveBeenCalled()
      expect(draftRepository.write).not.toHaveBeenCalled()
    })
  })

  describe("pipeline/AI failure mapping", () => {
    it("maps an Error rejection to a failed result and logs it before showing the panel", async () => {
      const pipelineError = new Error("AI 응답 없음")
      pipelineRunMock.mockRejectedValueOnce(pipelineError)
      const logger = createLogger()
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ logger, draftRepository })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toEqual({
        ok: false,
        kind: "failed",
        message: "초안 생성에 실패했습니다: AI 응답 없음"
      })
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith("Draft generation failed", pipelineError)
      expect(logger.show).toHaveBeenCalledTimes(1)
      expect(draftRepository.write).not.toHaveBeenCalled()
    })

    it("does not show the logger panel when suppressLoggerPanel is true", async () => {
      pipelineRunMock.mockRejectedValueOnce(new Error("AI 응답 없음"))
      const logger = createLogger()
      const dependencies = createDependencies({ logger })

      const result = await execute(
        dependencies,
        createRequest({ force: true, suppressLoggerPanel: true })
      )

      expect(result.ok).toBe(false)
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.show).not.toHaveBeenCalled()
    })

    it("falls back to String(error) when the pipeline rejects with a non-Error value", async () => {
      pipelineRunMock.mockRejectedValueOnce("provider offline")
      const dependencies = createDependencies()

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toEqual({
        ok: false,
        kind: "failed",
        message: "초안 생성에 실패했습니다: provider offline"
      })
    })
  })

  describe("draft history archiving", () => {
    it("archives the previous draft through archiveExistingDraft", async () => {
      archiveExistingDraftMock.mockResolvedValueOnce("2026-01-01-00-00-rev-01.md")
      const fileSystem = { ...stubFileSystem, exists: uriExistsMock, marker: "fs" }
      const dependencies = withFileSystem(createDependencies({}), fileSystem)

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).toHaveBeenCalledTimes(1)
      const archiveArgs = archiveExistingDraftMock.mock.calls[0][0] as {
        draftUri: unknown
        historyDirectory: unknown
        fileSystem: unknown
        resolveArchiveUri: (fileName: string) => unknown
      }
      expect(archiveArgs.draftUri).toEqual(draftPath(workspaceRoot, fakeScene.stem))
      expect(archiveArgs.historyDirectory).toEqual(
        joinStoryPath(workspaceRoot, ".storyboard", "cache", "revisions", fakeScene.stem)
      )
      expect(archiveArgs.fileSystem).toBe(fileSystem)
      expect(typeof archiveArgs.resolveArchiveUri).toBe("function")
    })

    it("archives the previous draft even when the draft is our own", async () => {
      const dependencies = withFileSystem(createDependencies({
          sceneCacheRepository: createSceneCacheRepository({
            read: vi.fn(async () => ({ inputHash: "sha256:0", bodyHash: ourDraftBodyHash }))
          })
        }), ourDraftFileSystem())

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).toHaveBeenCalledOnce()
    })

    it("archives a draft it did not write, with a warning", async () => {
      const logger = createLogger()
      const dependencies = createDependencies({
        logger
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("덮어쓰기 전에"))
    })

    it("archives a draft whose body no longer matches the recorded hash", async () => {
      const dependencies = withFileSystem(createDependencies({
          sceneCacheRepository: createSceneCacheRepository({
            read: vi.fn(async () => ({ inputHash: "sha256:0", bodyHash: computeDraftBodyHash("다른 본문") }))
          })
        }), ourDraftFileSystem())

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).toHaveBeenCalledTimes(1)
    })

    it("records the written body hash in the scene cache so the next run can recognize it", async () => {
      const sceneCacheRepository = createSceneCacheRepository()
      const dependencies = createDependencies({ sceneCacheRepository })

      await execute(dependencies, createRequest({ force: true }))

      const record = sceneCacheRepository.write.mock.calls[0]?.[1] as { bodyHash?: string }
      expect(record.bodyHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })

    it("records the scene coordinates in the scene cache for the review", async () => {
      pipelineRunMock.mockResolvedValue({
        ...pipelineSuccessResult,
        sceneCoordinates: ["1. 시각: 아침 / 장소: 거실"]
      })
      const sceneCacheRepository = createSceneCacheRepository()
      const dependencies = createDependencies({ sceneCacheRepository })

      await execute(dependencies, createRequest({ force: true }))

      const record = sceneCacheRepository.write.mock.calls[0]?.[1] as { sceneCoordinates?: readonly string[] }
      expect(record.sceneCoordinates).toEqual(["1. 시각: 아침 / 장소: 거실"])
    })

    it("logs how many lines the dialogue polish touched", async () => {
      pipelineRunMock.mockResolvedValue({
        ...pipelineSuccessResult,
        dialoguePolish: { lineCount: 5, polishedCount: 3, contestedCount: 1 }
      })
      const dependencies = createDependencies()

      await execute(dependencies, createRequest({ force: true }))

      const lines = (dependencies.host.logger as never as { info: ReturnType<typeof vi.fn> }).info.mock.calls.map(
        (call) => String(call[0])
      )
      expect(lines.some((line) => line.includes("대사 다듬기 3/5개 손봄, 1개는 화자가 겹쳐 뼈대 유지"))).toBe(true)
    })

    it("logs a warning and still persists the draft when archiving the previous draft fails", async () => {
      const archiveError = new Error("disk full")
      archiveExistingDraftMock.mockRejectedValueOnce(archiveError)
      const logger = createLogger()
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({
        logger,
        draftRepository
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(logger.warn).toHaveBeenCalledWith(
        `이전 초안을 판본으로 보관하지 못했습니다: ${String(archiveError)}`
      )
      expect(logger.error).not.toHaveBeenCalled()
      expect(draftRepository.write).toHaveBeenCalledTimes(1)
    })
  })

  describe("scene grounding", () => {
    it("derives the fact sheet from the card and the background without asking a model", async () => {
      const dependencies = createDependencies()

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: { scene: { frontmatter: { grounding: { place: "카페" } } } }
      })
    })

    it("builds the incident from the title and the first beat", async () => {
      const titledScene = {
        ...fakeScene,
        card: { type: "scene", id: "01-intro", beats: [{ text: "준서가 문을 연다", time: "새벽" }] },
        frontmatter: { title: "첫 만남" }
      }
      const dependencies = createDependencies({
        sceneRepository: { read: vi.fn(async () => titledScene), writeBeats: vi.fn(async () => undefined) }
      })

      await execute(dependencies, createRequest({ force: true }))

      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: {
          scene: {
            frontmatter: {
              grounding: { incident: "첫 만남: 준서가 문을 연다", place: "카페", time: "새벽" }
            }
          }
        }
      })
    })
  })

  describe("scene beats", () => {
    const beatScene = {
      ...fakeScene,
      frontmatter: { targetWordCount: 3000 },
      card: { type: "scene", id: "01-intro", purpose: "첫 만남", summary: "01-intro.summary.md" },
      summaryText: "준서가 하나를 만난다.\n",
      body: "[목적]\n첫 만남\n\n준서가 하나를 만난다."
    }

    function createBeatsDependencies(
      overrides: DependencyOverrides & { readonly scene?: typeof beatScene } = {}
    ): GenerateDraftServices {
      const scene = overrides.scene ?? beatScene
      buildSceneContextMock.mockReset().mockResolvedValue(sceneContext({ scene }))
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isAutoBeatsEnabled: () => true }),
        ...overrides
      })
      dependencies.repositories.scenes.read = vi.fn(async () => scene) as never
      return dependencies
    }

    it("proposes beats from the card and the summary, writes them, and feeds the beat body to the pipeline", async () => {
      const writeBeats = vi.fn(async () => undefined)
      const dependencies = createBeatsDependencies({ writeBeats })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(aiServiceStub.proposeSceneBeats).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneBody: "[목적]\n첫 만남\n",
          summary: "준서가 하나를 만난다.\n",
          characterNames: ["준서", "하나"],
          beatCount: 5
        }),
        expect.objectContaining({ providerId: "provider:sceneBeats" })
      )
      expect(writeBeats).toHaveBeenCalledWith(sceneUri, ["첫 비트", "둘째 비트"])
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: { scene: { body: "[목적]\n첫 만남\n\n[창작자 요약]\n준서가 하나를 만난다.\n\n첫 비트\n\n둘째 비트\n" } }
      })
    })

    it("derives the incident from the beats it just proposed, as the next run reading them will", async () => {
      const dependencies = createBeatsDependencies({
        scene: { ...beatScene, frontmatter: { targetWordCount: 3000, title: "첫 만남" } } as never
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: { scene: { frontmatter: { grounding: { incident: "첫 만남: 첫 비트" } } } }
      })
    })

    it("keeps existing beats and skips the proposal", async () => {
      const writeBeats = vi.fn(async () => undefined)
      const dependencies = createBeatsDependencies({
        writeBeats,
        scene: { ...beatScene, card: { ...beatScene.card, beats: ["이미 있는 비트"] } }
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(aiServiceStub.proposeSceneBeats).not.toHaveBeenCalled()
      expect(writeBeats).not.toHaveBeenCalled()
    })

    it("warns about a beat cast entry that is not a character of the scene", async () => {
      const dependencies = createBeatsDependencies({
        scene: {
          ...beatScene,
          card: { ...beatScene.card, beats: [{ text: "둘이 만난다", cast: ["juseo", "minsu"] }] }
        } as never
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect((result as { warnings: string[] }).warnings).toContain(
        "비트 1의 출연 «minsu»이(가) 이 씬의 인물 카드와 맞지 않아 그대로 프롬프트에 실렸습니다"
      )
    })

    it("skips beats entirely when generation.beats.auto is off", async () => {
      const writeBeats = vi.fn(async () => undefined)
      const dependencies = createBeatsDependencies({
        writeBeats,
        configBridge: createConfigBridge({ isAutoBeatsEnabled: () => false })
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(aiServiceStub.proposeSceneBeats).not.toHaveBeenCalled()
    })

    it("warns and generates from the card alone when the proposal fails", async () => {
      aiServiceStub.proposeSceneBeats.mockRejectedValueOnce(new Error("모델 오류"))
      const logger = createLogger()
      const writeBeats = vi.fn(async () => undefined)
      const dependencies = createBeatsDependencies({ writeBeats, logger })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(writeBeats).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("씬 비트를 전개하지 못했습니다"))
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: { scene: { body: beatScene.body } }
      })
    })
  })
})
