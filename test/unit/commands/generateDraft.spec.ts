import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SceneParseError } from "@/domain/files/scene"
import { workspace, type WorkspaceFolder } from "../../stubs/vscode"

const readSceneFileMock = vi.fn()
const readProjectJsonMock = vi.fn()
const buildSceneContextMock = vi.fn()

vi.mock("@/domain/files/scene", async () => {
  const actual = await vi.importActual<typeof import("@/domain/files/scene")>("@/domain/files/scene")
  return {
    ...actual,
    readSceneFile: (...args: unknown[]): unknown => readSceneFileMock(...args)
  }
})
vi.mock("@/infrastructure/vscode/workspace", () => ({
  hasStoryboardProject: async (): Promise<boolean> => true,
  uriExists: async (): Promise<boolean> => false
}))
vi.mock("@/infrastructure/persistence/projectJson", () => ({
  readProjectJson: (...args: unknown[]): unknown => readProjectJsonMock(...args)
}))
vi.mock("@/domain/sceneContext", () => ({
  buildSceneContext: (...args: unknown[]): unknown => buildSceneContextMock(...args),
  buildNarrativeContext: async (): Promise<unknown> => ({ prompt: undefined, bibleFacts: [] })
}))

import {
  GenerateDraftUseCase,
  type GenerateDraftResult,
  type GenerateDraftRequest,
  type GenerateDraftUseCaseDependencies
} from "@/application/drafts/generateDraftUseCase"

const workspaceRoot = vscode.Uri.file("/ws")
const sceneUri = vscode.Uri.file("/ws/scene/01-intro.txt")
const workspaceFolder: WorkspaceFolder = { uri: workspaceRoot as never, name: "ws", index: 0 }

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

function createOptions(
  logger: LoggerSpy,
  overrides: Partial<GenerateDraftRequest> = {}
): GenerateDraftUseCaseDependencies & GenerateDraftRequest {
  return {
    force: false,
    aiGateway: {
      createService: () => undefined,
      getTaskProvider: () => "mock"
    } as never,
    configBridge: { isAiContextCondenseEnabled: () => false } as never,
    draftRepository: {} as never,
    fileSystem: {} as never,
    logger: logger as never,
    projectRepository: {
      read: (...args: unknown[]): unknown => readProjectJsonMock(...args)
    } as never,
    sceneCacheRepository: {} as never,
    sceneRepository: {
      read: (...args: unknown[]): unknown => readSceneFileMock(...args)
    } as never,
    suppressLoggerPanel: false,
    ...overrides
  }
}

async function generateDraftForWorkspaceSceneWorkflow(
  sceneUri: vscode.Uri,
  options: GenerateDraftUseCaseDependencies & GenerateDraftRequest
): Promise<GenerateDraftResult> {
  return await new GenerateDraftUseCase(options).execute(sceneUri, options)
}

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

describe("generateDraftForWorkspaceSceneWorkflow failure reporting", () => {
  beforeEach(() => {
    readSceneFileMock.mockReset()
    readProjectJsonMock.mockReset()
    buildSceneContextMock.mockReset()

    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
  })

  it("returns the SceneParseError message without logging or showing the panel", async () => {
    const parseError = new SceneParseError("invalid-frontmatter-yaml", "프런트매터 오류")
    readSceneFileMock.mockRejectedValue(parseError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, createOptions(logger))

    expect(result).toEqual({
      ok: false,
      kind: "failed",
      message: "씬 파일을 읽을 수 없습니다: 프런트매터 오류"
    })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.show).not.toHaveBeenCalled()
  })

  it("logs and shows the panel on a non-parse scene read error", async () => {
    const readError = new Error("disk fault")
    readSceneFileMock.mockRejectedValue(readError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, createOptions(logger))

    expect(result).toEqual({
      ok: false,
      kind: "failed",
      message: "씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요."
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith("Failed to read scene file", readError)
    expect(logger.show).toHaveBeenCalledTimes(1)
  })

  it("does not show the panel on a scene read error when suppressLoggerPanel is true", async () => {
    const readError = new Error("disk fault")
    readSceneFileMock.mockRejectedValue(readError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(
      sceneUri,
      createOptions(logger, { suppressLoggerPanel: true })
    )

    expect(result).toEqual({
      ok: false,
      kind: "failed",
      message: "씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요."
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith("Failed to read scene file", readError)
    expect(logger.show).not.toHaveBeenCalled()
  })

  it("logs and shows the panel on a project.json read error", async () => {
    readSceneFileMock.mockResolvedValue(fakeScene)
    const projectError = new Error("invalid json")
    readProjectJsonMock.mockRejectedValue(projectError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, createOptions(logger))

    expect(result).toEqual({
      ok: false,
      kind: "failed",
      message: "project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요."
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith("Failed to read project.json", projectError)
    expect(logger.show).toHaveBeenCalledTimes(1)
  })

  it("does not show the panel on a project.json error when suppressLoggerPanel is true", async () => {
    readSceneFileMock.mockResolvedValue(fakeScene)
    const projectError = new Error("invalid json")
    readProjectJsonMock.mockRejectedValue(projectError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(
      sceneUri,
      createOptions(logger, { suppressLoggerPanel: true })
    )

    expect(result.ok).toBe(false)
    expect(logger.error).toHaveBeenCalledWith("Failed to read project.json", projectError)
    expect(logger.show).not.toHaveBeenCalled()
  })

  it("logs and shows the panel on a buildSceneContext error", async () => {
    readSceneFileMock.mockResolvedValue(fakeScene)
    readProjectJsonMock.mockResolvedValue(fakeProject)
    const contextError = new Error("context boom")
    buildSceneContextMock.mockRejectedValue(contextError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, createOptions(logger))

    expect(result).toEqual({
      ok: false,
      kind: "failed",
      message: "씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요."
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith("Failed to build scene context", contextError)
    expect(logger.show).toHaveBeenCalledTimes(1)
  })

  it("does not show the panel on a buildSceneContext error when suppressLoggerPanel is true", async () => {
    readSceneFileMock.mockResolvedValue(fakeScene)
    readProjectJsonMock.mockResolvedValue(fakeProject)
    const contextError = new Error("context boom")
    buildSceneContextMock.mockRejectedValue(contextError)
    const logger = createLogger()

    const result = await generateDraftForWorkspaceSceneWorkflow(
      sceneUri,
      createOptions(logger, { suppressLoggerPanel: true })
    )

    expect(result.ok).toBe(false)
    expect(logger.error).toHaveBeenCalledWith("Failed to build scene context", contextError)
    expect(logger.show).not.toHaveBeenCalled()
  })
})
