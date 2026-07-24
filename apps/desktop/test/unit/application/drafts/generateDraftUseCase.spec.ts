import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { draftHistorySceneDirectory, draftPath } from "@/infrastructure/vscode/pathConventions"
import { computeSceneInputHash } from "@/domain/files/sceneCache"
import { workspace, type WorkspaceFolder } from "../../../stubs/vscode"

const buildSceneContextMock = vi.fn()
const buildNarrativeContextMock = vi.fn()
const uriExistsMock = vi.fn()
const archiveExistingDraftMock = vi.fn()
const pipelineRunMock = vi.fn()

vi.mock("@storyboard/story-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-format")>()),
  buildSceneContext: (...args: unknown[]): unknown => buildSceneContextMock(...args),
  buildNarrativeContext: (...args: unknown[]): unknown => buildNarrativeContextMock(...args)
}))
vi.mock("@/infrastructure/vscode/workspace", () => ({
  hasStoryboardProject: async (): Promise<boolean> => true,
  uriExists: (...args: unknown[]): unknown => uriExistsMock(...args)
}))
vi.mock("@/domain/files/draftHistory", () => ({
  archiveExistingDraft: (...args: unknown[]): unknown => archiveExistingDraftMock(...args)
}))
vi.mock('@storyboard/story-pipeline', async () => {
  const actual = await vi.importActual<
    typeof import('@storyboard/story-pipeline')
  >('@storyboard/story-pipeline')
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
  type GenerateDraftUseCaseDependencies
} from "@/application/drafts/generateDraftUseCase"
import { SceneGenerationPipelineCancelledError } from '@storyboard/story-pipeline'

const workspaceRoot = vscode.Uri.file("/ws")
const sceneUri = vscode.Uri.file("/ws/scene/01-intro.txt")
const workspaceFolder: WorkspaceFolder = { uri: workspaceRoot as never, name: "ws", index: 0 }

const fakeScene = {
  stem: "01-intro",
  order: 1,
  orderText: "01",
  slug: "intro",
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

const aiServiceStub = { marker: "ai-service" }

const pipelineSuccessResult = {
  draftBody: "생성된 초안 본문",
  detectedCharacters: ["준서"],
  situations: [],
  personasUsed: new Map<string, string>(),
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
  readonly isAiContextCondenseEnabled: () => boolean
  readonly isKeepDraftHistoryEnabled: () => boolean
  readonly isUpdateCardsAfterGenerateEnabled: () => boolean
  readonly isVerifyCardCandidatesEnabled: () => boolean
}

function createConfigBridge(overrides: Partial<ConfigBridgeStub> = {}): ConfigBridgeStub {
  return {
    getDraftSceneBreakSeparator: () => undefined,
    isAiContextCondenseEnabled: () => false,
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
}

function createDependencies(overrides: DependencyOverrides = {}): GenerateDraftUseCaseDependencies {
  return {
    aiGateway: {
      createService: () => aiServiceStub,
      getTaskProvider: (task: string) => `provider:${task}`
    },
    configBridge: overrides.configBridge ?? createConfigBridge(),
    draftRepository: overrides.draftRepository ?? createDraftRepository(),
    fileSystem: {},
    logger: overrides.logger ?? createLogger(),
    postGenerationUpdates: overrides.postGenerationUpdates,
    projectRepository: { read: vi.fn(async () => fakeProject) },
    sceneCacheRepository: overrides.sceneCacheRepository ?? createSceneCacheRepository(),
    sceneRepository: { read: vi.fn(async () => fakeScene) }
  } as never
}

function createRequest(overrides: Partial<GenerateDraftRequest> = {}): GenerateDraftRequest {
  return { force: false, ...overrides }
}

async function execute(
  dependencies: GenerateDraftUseCaseDependencies,
  request: GenerateDraftRequest
): Promise<GenerateDraftResult> {
  return await new GenerateDraftUseCase(dependencies).execute(sceneUri, request)
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
  })

  describe("cache hit and force", () => {
    it("returns the cached draft without invoking the generation pipeline when the input hash matches", async () => {
      const matchingHash = computeSceneInputHash({
        sceneBody: fakeScene.body,
        characters: [primaryCharacterCard, secondaryCharacterCard] as never,
        background: sceneBackgroundCard as never,
        format: fakeProject.format as never,
        bibleFacts: [],
        sceneBreakJoiner: undefined
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

    it("bypasses the cache and regenerates when force is true, without reading the cache record", async () => {
      const cacheRead = vi.fn(async () => {
        throw new Error("sceneCacheRepository.read must not be called when force is true")
      })
      const sceneCacheRepository = createSceneCacheRepository({ read: cacheRead })
      const draftRepository = createDraftRepository()
      const dependencies = createDependencies({ sceneCacheRepository, draftRepository })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result).toMatchObject({ ok: true, kind: "generated" })
      expect(cacheRead).not.toHaveBeenCalled()
      expect(pipelineRunMock).toHaveBeenCalledTimes(1)
      expect(draftRepository.write).toHaveBeenCalledTimes(1)
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
      const fileSystem = { marker: "fs" }
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

    it("does not archive the previous draft when keep-draft-history is disabled", async () => {
      const dependencies = createDependencies({
        configBridge: createConfigBridge({ isKeepDraftHistoryEnabled: () => false })
      })

      const result = await execute(dependencies, createRequest({ force: true }))

      expect(result.kind).toBe("generated")
      expect(archiveExistingDraftMock).not.toHaveBeenCalled()
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
})
