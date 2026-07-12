import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const readSceneFileMock = vi.fn()
const readProjectJsonMock = vi.fn()
const buildSceneContextMock = vi.fn()
const buildNarrativeContextMock = vi.fn()

vi.mock("@/files/scene", () => ({
  SceneParseError: class SceneParseError extends Error {},
  readSceneFile: (...args: unknown[]): unknown => readSceneFileMock(...args)
}))
vi.mock("@/files/projectJson", () => ({
  readProjectJson: (...args: unknown[]): unknown => readProjectJsonMock(...args)
}))
vi.mock("@/core/sceneContext", () => ({
  buildNarrativeContext: (...args: unknown[]): unknown => buildNarrativeContextMock(...args),
  buildSceneContext: (...args: unknown[]): unknown => buildSceneContextMock(...args),
  formatBibleFactLines: (): string[] => []
}))

import { AugmentDraftUseCase } from "@/application/drafts/augment-draft-use-case"
import { SceneParseError } from "@/files/scene"

function createUseCase(): {
  gateway: { createService: ReturnType<typeof vi.fn>; getTaskProvider: ReturnType<typeof vi.fn> }
  useCase: AugmentDraftUseCase
} {
  const gateway = {
    createService: vi.fn(),
    getTaskProvider: vi.fn(() => "mock")
  }

  return {
    gateway,
    useCase: new AugmentDraftUseCase(gateway as never, { error: vi.fn() } as never)
  }
}

function request(): Parameters<AugmentDraftUseCase["execute"]>[0] {
  return {
    draftSceneStem: "01-arrival",
    sceneUri: vscode.Uri.file("/workspace/scene/01-arrival.txt"),
    scope: "draft",
    target: "초안 본문",
    workspaceRoot: vscode.Uri.file("/workspace")
  }
}

describe("AugmentDraftUseCase", () => {
  beforeEach(() => {
    readSceneFileMock.mockReset()
    readProjectJsonMock.mockReset()
    buildSceneContextMock.mockReset()
    buildNarrativeContextMock.mockReset()
  })

  it("returns a specific failure when the linked scene is invalid", async () => {
    readSceneFileMock.mockRejectedValue(new SceneParseError("frontmatter 오류"))
    const { gateway, useCase } = createUseCase()

    const result = await useCase.execute(request())

    expect(result).toEqual({
      kind: "failed",
      message: "연결된 씬 파일을 읽을 수 없습니다: frontmatter 오류",
      ok: false
    })
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("returns an empty result without applying an empty AI response", async () => {
    readSceneFileMock.mockResolvedValue({ body: "씬 의도" })
    readProjectJsonMock.mockResolvedValue({ format: "novel" })
    buildSceneContextMock.mockResolvedValue({
      background: undefined,
      characters: [],
      scene: { body: "씬 의도" }
    })
    buildNarrativeContextMock.mockResolvedValue({ bibleFacts: [] })
    const augmentDraft = vi.fn(async () => "   ")
    const { gateway, useCase } = createUseCase()
    gateway.createService.mockReturnValue({ augmentDraft })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "empty", ok: false })
  })
})
