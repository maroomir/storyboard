import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { draftHistorySceneDirectory, draftPath } from "@/infrastructure/vscode/pathConventions"
import { computeSceneInputHash } from "@storyboard/story-engine"
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
vi.mock("@storyboard/story-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-engine")>()),
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
import { computeDraftBodyHash, createDraft, parseDraft, serializeDraft } from '@storyboard/story-format'

const workspaceRoot = vscode.Uri.file("/ws")
const sceneUri = vscode.Uri.file("/ws/scene/01-intro.card")
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

const aiServiceStub = {
  marker: "ai-service",
  proposeSceneGrounding: vi.fn(async () => ({ incident: "제안된 사건" }))
}

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
  readonly isSceneGroundingAutoApproveEnabled: () => boolean
  readonly isAiContextCondenseEnabled: () => boolean
  readonly isKeepDraftHistoryEnabled: () => boolean
  readonly isUpdateCardsAfterGenerateEnabled: () => boolean
  readonly isVerifyCardCandidatesEnabled: () => boolean
}

function createConfigBridge(overrides: Partial<ConfigBridgeStub> = {}): ConfigBridgeStub {
  return {
    getDraftSceneBreakSeparator: () => undefined,
    isSceneGroundingAutoApproveEnabled: () => true,
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
  readonly writeGrounding?: ReturnType<typeof vi.fn>
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
    fileSystem: {},
    generator: "storyboard@0.0.0-test",
    logger: overrides.logger ?? createLogger(),
    postGenerationUpdates: overrides.postGenerationUpdates,
    projectRepository: { read: vi.fn(async () => fakeProject) },
    sceneCacheRepository: overrides.sceneCacheRepository ?? createSceneCacheRepository(),
    sceneRepository: {
      read: vi.fn(async () => fakeScene),
      writeGrounding: overrides.writeGrounding ?? vi.fn(async () => undefined)
    }
  } as never
}

// 디스크에 이미 있는 '우리가 쓴' 초안을 흉내 낸다. 본문 해시가 씬 캐시 기록과 맞으면 덮어써도
// 잃을 것이 없다는 판정이 된다.
const ourDraftBody = pipelineSuccessResult.draftBody
const ourDraftBodyHash = computeDraftBodyHash(
  parseDraft(serializeDraft(createDraft({ sceneStem: fakeScene.stem, format: "novel", body: ourDraftBody }))).body
)

function ourDraftFileSystem(): { readFile: () => Promise<Uint8Array> } {
  const serialized = serializeDraft(
    createDraft({ sceneStem: fakeScene.stem, format: "novel", body: ourDraftBody })
  )
  return { readFile: async (): Promise<Uint8Array> => new TextEncoder().encode(serialized) }
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
    aiServiceStub.proposeSceneGrounding.mockClear()
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

    // force는 캐시 적중 판정을 건너뛴다. 덮어쓰기 전 출처 판정은 그와 별개로 여전히 수행하므로
    // 여기서 캐시 기록을 읽는 것 자체는 정상이다 — 읽지 않으면 봇 초안을 보관 없이 지운다.
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

    // 봇이 쓴 초안은 씬 캐시 기록이 없어 판정이 불가능하다. draft/는 기본 gitignore이고
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
})
