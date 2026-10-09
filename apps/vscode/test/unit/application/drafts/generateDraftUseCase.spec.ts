import { stubFileSystem } from "../../../stubs/fileSystem"
import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  draftHistorySceneDirectory,
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
  ...(await importOriginal<typeof import("@storyboard/story-model")>()),
  buildSceneContext: (...args: unknown[]): unknown => buildSceneContextMock(...args),
  buildNarrativeContext: (...args: unknown[]): unknown => buildNarrativeContextMock(...args)
}))
vi.mock("../../../../../../packages/story-model/src/domain/files/draftHistory", async (
  importOriginal
) => ({
  ...(await importOriginal<
    typeof import("../../../../../../packages/story-model/src/domain/files/draftHistory")
  >()),
  archiveExistingDraft: (...args: unknown[]): unknown => archiveExistingDraftMock(...args)
}))
vi.mock('../../../../../../packages/story-engine/src/pipeline/sceneGenerationPipeline', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../../../packages/story-engine/src/pipeline/sceneGenerationPipeline')
  >('../../../../../../packages/story-engine/src/pipeline/sceneGenerationPipeline')
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
  type GenerateDraftRequest,
  type GenerateDraftResult,
  type GenerateDraftUseCaseDependencies,
  SceneGenerationPipelineCancelledError,
} from "@storyboard/story-engine"

const workspaceRoot = vscode.Uri.file("/ws")
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
  editor: { scenePrefixDigits: 2 }
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
  locationKind: "place"
}

const aiServiceStub = {
  marker: "ai-service",
  proposeSceneGrounding: vi.fn(async () => ({ incident: "제안된 사건" })),
  proposeSceneBeats: vi.fn(async () => ["첫 비트", "둘째 비트"])
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
  readonly isSceneGroundingAutoApproveEnabled: () => boolean
  readonly isAutoBeatsEnabled: () => boolean
  readonly getCharsPerBeat: () => number
  readonly getMinBeats: () => number
  readonly isAiContextCondenseEnabled: () => boolean
  readonly getSectionOutputLimit: () => number
  readonly getSceneGenerationTuning: () => Record<string, number>
  readonly isKeepDraftHistoryEnabled: () => boolean
  readonly isUpdateCardsAfterGenerateEnabled: () => boolean
  readonly isVerifyCardCandidatesEnabled: () => boolean
}

function createConfigBridge(overrides: Partial<ConfigBridgeStub> = {}): ConfigBridgeStub {
  return {
    getDraftSceneBreakSeparator: () => undefined,
    isSceneGroundingAutoApproveEnabled: () => true,
    isAutoBeatsEnabled: () => false,
    getCharsPerBeat: () => 1500,
    getMinBeats: () => 5,
    isAiContextCondenseEnabled: () => false,
    getSectionOutputLimit: () => 7000,
    getSceneGenerationTuning: () => ({}),
    isKeepDraftHistoryEnabled: () => false,
    isUpdateCardsAfterGenerateEnabled: () => false,
    isVerifyCardCandidatesEnabled: () => false,
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

interface PostGenerationUpdatesStub {
  readonly scheduleCharacterTraits: ReturnType<typeof vi.fn>
  readonly scheduleBibleCandidates: ReturnType<typeof vi.fn>
  readonly scheduleCardCandidates: ReturnType<typeof vi.fn>
  readonly scheduleBackgroundCharacters: ReturnType<typeof vi.fn>
}

function createPostGenerationUpdates(): PostGenerationUpdatesStub {
  return {
    scheduleCharacterTraits: vi.fn(),
    scheduleBibleCandidates: vi.fn(),
    scheduleCardCandidates: vi.fn(),
    scheduleBackgroundCharacters: vi.fn()
  }
}

interface DependencyOverrides {
  readonly configBridge?: ConfigBridgeStub
  readonly draftRepository?: DraftRepositoryStub
  readonly logger?: LoggerSpy
  readonly postGenerationUpdates?: PostGenerationUpdatesStub
  readonly sceneCacheRepository?: SceneCacheRepositoryStub
  readonly writeGrounding?: ReturnType<typeof vi.fn>
  readonly writeBeats?: ReturnType<typeof vi.fn>
  readonly sceneRepository?: unknown
  readonly sceneGroundingGapRepository?: unknown
}

function createGroundingGapRepository(): unknown {
  const records = new Map<string, unknown>()
  return {
    read: async (_uri: unknown, stem: string): Promise<unknown> => records.get(stem),
    write: async (_uri: unknown, stem: string, gap: unknown): Promise<void> => {
      if (gap === undefined) {
        records.delete(stem)
      } else {
        records.set(stem, gap)
      }
    }
  }
}

function createDependencies(overrides: DependencyOverrides = {}): GenerateDraftUseCaseDependencies {
  return {
    aiGateway: {
      createService: () => aiServiceStub,
      getTaskProvider: (task: string) => `provider:${task}`,
      getTaskAiConfig: (task: string) => ({ providerId: `provider:${task}`, model: `model:${task}` })
    },
    configBridge: overrides.configBridge ?? createConfigBridge(),
    draftRepository: overrides.draftRepository ?? createDraftRepository(),
    fileSystem: overrides.fileSystem ?? { ...stubFileSystem, exists: uriExistsMock },
    generator: "storyboard@0.0.0-test",
    logger: overrides.logger ?? createLogger(),
    postGenerationUpdates: overrides.postGenerationUpdates,
    projectRepository: { read: vi.fn(async () => fakeProject) },
    sceneCacheRepository: overrides.sceneCacheRepository ?? createSceneCacheRepository(),
    workspaceLocator: {
      folders: () => workspace.workspaceFolders ?? [],
      folderFor: (uri: never) => workspace.getWorkspaceFolder(uri)
    },
    sceneRepository: overrides.sceneRepository ?? {
      read: vi.fn(async () => fakeScene),
      writeGrounding: overrides.writeGrounding ?? vi.fn(async () => undefined),
      writeBeats: overrides.writeBeats ?? vi.fn(async () => undefined)
    },
    sceneGroundingGapRepository: overrides.sceneGroundingGapRepository ?? createGroundingGapRepository()
  } as never
}

// 디스크에 이미 있는 '우리가 쓴' 초안을 흉내 낸다. 본문 해시가 씬 캐시 기록과 맞으면 덮어써도
// 잃을 것이 없다는 판정이 된다.
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
  dependencies: GenerateDraftUseCaseDependencies,
  request: GenerateDraftRequest
): Promise<GenerateDraftResult> {
  return await new GenerateDraftUseCase(dependencies).execute({ ...request, sceneUri })
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
    aiServiceStub.proposeSceneGrounding.mockClear()
    aiServiceStub.proposeSceneBeats.mockClear()
  })

  // QA D5: an empty model response was saved over the existing draft and reported as success. No
  // provider is trusted on this: an empty body never replaces a draft.
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
        grounding: { incident: "제안된 사건" }
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

    // #100: 씬 캐시는 gitignore 대상이라 git으로 받은 작품에는 없다. 커밋되는 원장의 입력 해시가
    // 같으면 그대로인 초안을 다시 생성하지 않는다.
    describe("without a scene cache", () => {
      const groundedHash = computeSceneInputHash({
        sceneBody: fakeScene.body,
        characters: [primaryCharacterCard, secondaryCharacterCard] as never,
        background: sceneBackgroundCard as never,
        format: fakeProject.format as never,
        bibleFacts: [],
        sceneBreakJoiner: undefined,
        grounding: { incident: "제안된 사건" }
      })

      function clonedWorkspaceFileSystem(ledgerInputHash: string): IFileSystem {
        const ledger = `# 이야기 상태\n<!-- through-scene: 1 -->\n<!-- scene-input: 1 ${ledgerInputHash} -->\n`
        return {
          ...stubFileSystem,
          exists: async (uri) => !uri.path.includes("/.storyboard/cache/"),
          readFile: async (uri): Promise<Uint8Array> => {
            if (uri.path.endsWith("/storyState.md")) {
              return new TextEncoder().encode(ledger)
            }
            throw new Error(`not found: ${uri.path}`)
          }
        }
      }

      it("keeps the draft when the ledger recorded the same input hash", async () => {
        const sceneCacheRepository = createSceneCacheRepository()
        const draftRepository = createDraftRepository()
        const dependencies = createDependencies({
          sceneCacheRepository,
          draftRepository,
          fileSystem: clonedWorkspaceFileSystem(groundedHash)
        })

        const result = await execute(dependencies, createRequest({ force: false }))

        expect(result).toMatchObject({ ok: true, kind: "cache_hit" })
        expect(pipelineRunMock).not.toHaveBeenCalled()
        expect(draftRepository.write).not.toHaveBeenCalled()
      })

      it("regenerates when the ledger recorded a different input hash", async () => {
        const dependencies = createDependencies({
          fileSystem: clonedWorkspaceFileSystem(`sha256:${"0".repeat(64)}`)
        })

        const result = await execute(dependencies, createRequest({ force: false }))

        expect(result).toMatchObject({ ok: true, kind: "generated" })
        expect(pipelineRunMock).toHaveBeenCalledTimes(1)
      })
    })

    // force는 캐시 적중 판정을 건너뛴다. 덮어쓰기 전 출처 판정은 그와 별개로 여전히 수행하므로
    // 여기서 캐시 기록을 읽는 것 자체는 정상이다 — 읽지 않으면 남이 쓴 초안을 보관 없이 지운다.
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
    it("archives the previous draft through archiveExistingDraft when keep-draft-history is enabled", async () => {
      archiveExistingDraftMock.mockResolvedValueOnce("2026-01-01-00-00-rev-01.md")
      const fileSystem = { ...stubFileSystem, exists: uriExistsMock, marker: "fs" }
      const dependencies = {
        ...createDependencies({
          configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => true })
        }),
        fileSystem
      } as never as GenerateDraftUseCaseDependencies

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
        draftHistorySceneDirectory(workspaceRoot, fakeScene.stem)
      )
      expect(archiveArgs.fileSystem).toBe(fileSystem)
      expect(typeof archiveArgs.resolveArchiveUri).toBe("function")
    })

    it("does not archive the previous draft when keep-draft-history is disabled and the draft is our own", async () => {
      const dependencies = {
        ...createDependencies({
          configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => false }),
          sceneCacheRepository: createSceneCacheRepository({
            read: vi.fn(async () => ({ inputHash: "sha256:0", bodyHash: ourDraftBodyHash }))
          })
        }),
        fileSystem: ourDraftFileSystem()
      } as never as GenerateDraftUseCaseDependencies

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).not.toHaveBeenCalled()
    })

    // 캐시 기록 없이 만들어진 초안은 출처 판정이 불가능하다. draft/는 기본 gitignore이고
    // keepHistory 기본값이 꺼짐이라, 보관하지 않으면 되돌릴 곳이 없다.
    it("archives a draft it did not write even when keep-draft-history is disabled", async () => {
      const logger = createLogger()
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => false }),
        logger
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("덮어쓰기 전에"))
    })

    it("archives a draft whose body no longer matches the recorded hash", async () => {
      const dependencies = {
        ...createDependencies({
          configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => false }),
          sceneCacheRepository: createSceneCacheRepository({
            read: vi.fn(async () => ({ inputHash: "sha256:0", bodyHash: computeDraftBodyHash("다른 본문") }))
          })
        }),
        fileSystem: ourDraftFileSystem()
      } as never as GenerateDraftUseCaseDependencies

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

      const lines = (dependencies as never as { logger: { info: ReturnType<typeof vi.fn> } }).logger.info.mock.calls.map(
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
        configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => true }),
        logger,
        draftRepository
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(logger.warn).toHaveBeenCalledWith(
        `이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(archiveError)}`
      )
      expect(logger.error).not.toHaveBeenCalled()
      expect(draftRepository.write).toHaveBeenCalledTimes(1)
    })
  })

  describe("post-generation update scheduling", () => {
    it("schedules character traits, bible, card, and background updates when the config gate is enabled", async () => {
      const updates = createPostGenerationUpdates()
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isUpdateCardsAfterGenerateEnabled: () => true }),
        postGenerationUpdates: updates
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(updates.scheduleCharacterTraits).toHaveBeenCalledTimes(1)
      expect(updates.scheduleCharacterTraits).toHaveBeenCalledWith(
        expect.objectContaining({
          queueKey: workspaceRoot.toString(),
          sceneStem: fakeScene.stem,
          draftBody: pipelineSuccessResult.draftBody,
          detectedCharacterCards: [primaryCharacterCard],
          aiService: aiServiceStub
        })
      )
      expect(updates.scheduleBibleCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          queueKey: `${workspaceRoot.toString()}#bible`,
          sceneStem: fakeScene.stem
        })
      )
      expect(updates.scheduleCardCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          queueKey: `${workspaceRoot.toString()}#cards`,
          verify: false
        })
      )
      expect(updates.scheduleBackgroundCharacters).toHaveBeenCalledWith(
        expect.objectContaining({
          queueKey: `${workspaceRoot.toString()}#background`,
          backgroundId: sceneBackgroundCard.id
        })
      )
    })

    it("does not schedule any post-generation updates when the config gate is disabled", async () => {
      const updates = createPostGenerationUpdates()
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isUpdateCardsAfterGenerateEnabled: () => false }),
        postGenerationUpdates: updates
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(updates.scheduleCharacterTraits).not.toHaveBeenCalled()
      expect(updates.scheduleBibleCandidates).not.toHaveBeenCalled()
      expect(updates.scheduleCardCandidates).not.toHaveBeenCalled()
      expect(updates.scheduleBackgroundCharacters).not.toHaveBeenCalled()
    })

    it("does not schedule background character updates when the scene has no background card", async () => {
      buildSceneContextMock.mockResolvedValueOnce(sceneContext({ background: undefined }))
      const updates = createPostGenerationUpdates()
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isUpdateCardsAfterGenerateEnabled: () => true }),
        postGenerationUpdates: updates
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(updates.scheduleBackgroundCharacters).not.toHaveBeenCalled()
      expect(updates.scheduleCharacterTraits).toHaveBeenCalledTimes(1)
    })

    it("does not throw when the config gate is enabled but no postGenerationUpdates dependency is provided", async () => {
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isUpdateCardsAfterGenerateEnabled: () => true })
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
    })
  })

  describe("scene grounding", () => {
    it("proposes only the missing fields, writes them to the scene, and feeds them to the pipeline", async () => {
      const writeGrounding = vi.fn(async () => undefined)
      const dependencies = createDependencies({ writeGrounding })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(aiServiceStub.proposeSceneGrounding).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneBody: fakeScene.body,
          missingFields: ["incident", "place", "relation", "time"],
          // 카드 id가 아니라 해석된 인물 이름으로 제안받아야 본문에 슬러그가 새지 않는다.
          characterNames: ["준서", "하나"]
        }),
        expect.anything()
      )
      expect(writeGrounding).toHaveBeenCalledWith(sceneUri, { incident: "제안된 사건" })
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        context: { scene: { frontmatter: { grounding: { incident: "제안된 사건" } } } }
      })
    })

    // 모델이 끝내 비워 둔 칸을 실행마다 다시 물어 초안을 캐시로 두는데도 비용이 들었다.
    describe("fields the model left blank", () => {
      function sceneThatRemembersItsGrounding(): { repository: unknown; changeBody: (body: string) => void } {
        let current: typeof fakeScene & { frontmatter: Record<string, unknown> } = { ...fakeScene }
        return {
          repository: {
            read: vi.fn(async () => current),
            writeGrounding: vi.fn(async (_uri: unknown, grounding: unknown) => {
              current = { ...current, frontmatter: { ...current.frontmatter, grounding } }
            }),
            writeBeats: vi.fn(async () => undefined)
          },
          changeBody: (body: string): void => {
            current = { ...current, body }
          }
        }
      }

      it("are not asked for again until the scene changes", async () => {
        const scene = sceneThatRemembersItsGrounding()
        const dependencies = createDependencies({ sceneRepository: scene.repository })

        await execute(dependencies, createRequest({ force: true }))
        await execute(dependencies, createRequest({ force: true }))
        expect(aiServiceStub.proposeSceneGrounding).toHaveBeenCalledTimes(1)

        scene.changeBody("고친 씬 본문")
        await execute(dependencies, createRequest({ force: true }))
        expect(aiServiceStub.proposeSceneGrounding).toHaveBeenCalledTimes(2)
      })

      it("are asked for again after a proposal that failed", async () => {
        const scene = sceneThatRemembersItsGrounding()
        const dependencies = createDependencies({ sceneRepository: scene.repository })
        aiServiceStub.proposeSceneGrounding.mockRejectedValueOnce(new Error("network"))

        await execute(dependencies, createRequest({ force: true }))
        await execute(dependencies, createRequest({ force: true }))

        expect(aiServiceStub.proposeSceneGrounding).toHaveBeenCalledTimes(2)
      })
    })

    it("keeps user-authored grounding and skips the proposal when every field is filled", async () => {
      const grounded = {
        ...fakeScene,
        frontmatter: {
          grounding: {
            incident: "면접 탈락",
            place: "옥탑방",
            relation: "아랫집 이웃",
            time: "11월 말"
          }
        }
      }
      buildSceneContextMock.mockReset().mockResolvedValue(sceneContext({ scene: grounded }))
      const writeGrounding = vi.fn(async () => undefined)
      const dependencies = createDependencies({ writeGrounding })
      dependencies.sceneRepository.read = vi.fn(async () => grounded) as never

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(aiServiceStub.proposeSceneGrounding).not.toHaveBeenCalled()
      expect(writeGrounding).not.toHaveBeenCalled()
    })

    it("cancels generation when the approval callback rejects the proposal", async () => {
      const writeGrounding = vi.fn(async () => undefined)
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isSceneGroundingAutoApproveEnabled: () => false }),
        writeGrounding
      })

      const result = await execute(
        dependencies,
        createRequest({ force: true, confirmSceneGrounding: async () => undefined })
      )

      expect(result).toEqual({ ok: false, kind: "cancelled" })
      expect(writeGrounding).not.toHaveBeenCalled()
      expect(pipelineRunMock).not.toHaveBeenCalled()
    })

    it("writes the edited grounding when the approval callback returns a revision", async () => {
      const writeGrounding = vi.fn(async () => undefined)
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isSceneGroundingAutoApproveEnabled: () => false }),
        writeGrounding
      })

      const result = await execute(
        dependencies,
        createRequest({
          force: true,
          confirmSceneGrounding: async () => ({ incident: "사용자가 고친 사건" })
        })
      )

      expect(result.kind).toBe("generated")
      expect(writeGrounding).toHaveBeenCalledWith(sceneUri, { incident: "사용자가 고친 사건" })
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
    ): GenerateDraftUseCaseDependencies {
      const scene = overrides.scene ?? beatScene
      buildSceneContextMock.mockReset().mockResolvedValue(sceneContext({ scene }))
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isAutoBeatsEnabled: () => true }),
        ...overrides
      })
      dependencies.sceneRepository.read = vi.fn(async () => scene) as never
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
          // max(minBeats 5, ceil(3000 / 1500))
          beatCount: 5
        }),
        expect.objectContaining({ providerId: "provider:sceneBeats" })
      )
      expect(writeBeats).toHaveBeenCalledWith(sceneUri, ["첫 비트", "둘째 비트"])
      expect(pipelineRunMock.mock.calls[0]?.[0]).toMatchObject({
        // 비트가 생긴 뒤에도 요약 메모는 [창작자 요약] 설계 블록으로 남는다(#88-1).
        context: { scene: { body: "[목적]\n첫 만남\n\n[창작자 요약]\n준서가 하나를 만난다.\n\n첫 비트\n\n둘째 비트\n" } }
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
