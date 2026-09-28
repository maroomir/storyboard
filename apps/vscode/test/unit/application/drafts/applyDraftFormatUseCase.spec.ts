import { stubFileSystem } from "../../../stubs/fileSystem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const readProjectJsonMock = vi.fn()
const readDraftFileMock = vi.fn()
const parseDraftMock = vi.fn()
const createDraftMock = vi.fn()
const writeDraftFileMock = vi.fn()

vi.mock("../../../../../../packages/story-engine/src/persistence/projectJson", () => ({
  readProjectJson: (...args: unknown[]): unknown => readProjectJsonMock(...args)
}))
vi.mock("@storyboard/story-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-format")>()),
  readDraftFile: (...args: unknown[]): unknown => readDraftFileMock(...args),
  parseDraft: (...args: unknown[]): unknown => parseDraftMock(...args),
  createDraft: (...args: unknown[]): unknown => createDraftMock(...args),
  writeDraftFile: (...args: unknown[]): unknown => writeDraftFileMock(...args)
}))

import { ApplyDraftFormatUseCase } from "@storyboard/story-engine"

function createUseCase(): {
  gateway: { createService: ReturnType<typeof vi.fn>; getTaskProvider: ReturnType<typeof vi.fn> }
  logger: { error: ReturnType<typeof vi.fn> }
  useCase: ApplyDraftFormatUseCase
} {
  const gateway = {
    createService: vi.fn(),
    getTaskProvider: vi.fn(() => "mock"),
    getTaskAiConfig: vi.fn(() => ({ providerId: "mock", model: "mock-model" }))
  }
  const logger = { error: vi.fn() }

  return {
    gateway,
    logger,
    useCase: new ApplyDraftFormatUseCase({
      fileSystem: stubFileSystem,
      aiGateway: gateway as never,
      logger: logger as never,
      generator: "storyboard@0.0.0-test"
    })
  }
}

function request(): Parameters<ApplyDraftFormatUseCase["execute"]>[0] {
  return {
    workspaceRoot: vscode.Uri.file("/workspace"),
    sceneStem: "01-arrival"
  }
}

function stubParsedDraft(): void {
  readProjectJsonMock.mockResolvedValue({ format: "novel" })
  readDraftFileMock.mockResolvedValue("---\n---\n원문")
  parseDraftMock.mockReturnValue({
    body: "원문",
    sceneStem: "01-arrival",
    generatedAt: "2024-01-01T00:00:00.000Z"
  })
}

describe("ApplyDraftFormatUseCase", () => {
  beforeEach(() => {
    readProjectJsonMock.mockReset()
    readDraftFileMock.mockReset()
    parseDraftMock.mockReset()
    createDraftMock.mockReset()
    writeDraftFileMock.mockReset()
  })

  it("returns project_unreadable and logs when project.json cannot be read", async () => {
    readProjectJsonMock.mockRejectedValue(new Error("read fail"))
    const { gateway, logger, useCase } = createUseCase()

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "project_unreadable", ok: false })
    expect(logger.error).toHaveBeenCalledWith("Failed to read project.json", expect.any(Error))
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("returns draft_missing without applying when the draft file is absent", async () => {
    readProjectJsonMock.mockResolvedValue({ format: "novel" })
    readDraftFileMock.mockRejectedValue(new Error("not found"))
    const { gateway, useCase } = createUseCase()

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "draft_missing", ok: false })
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("returns failed when the AI format call throws", async () => {
    stubParsedDraft()
    const { gateway, logger, useCase } = createUseCase()
    gateway.createService.mockReturnValue({
      applyGenreFormat: vi.fn(async () => {
        throw new Error("ai down")
      })
    })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "failed", message: "ai down", ok: false })
    expect(logger.error).toHaveBeenCalledWith("Apply draft format failed", expect.any(Error))
    expect(writeDraftFileMock).not.toHaveBeenCalled()
  })

  it("returns failed when writing the formatted draft throws", async () => {
    stubParsedDraft()
    createDraftMock.mockReturnValue({ body: "포맷됨" })
    writeDraftFileMock.mockRejectedValue(new Error("disk full"))
    const { gateway, useCase } = createUseCase()
    gateway.createService.mockReturnValue({ applyGenreFormat: vi.fn(async () => "포맷됨") })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "failed", message: "disk full", ok: false })
  })

  it("formats, saves, and returns the draft uri on success", async () => {
    stubParsedDraft()
    const formattedDraft = { sceneStem: "01-arrival", format: "novel", body: "포맷됨" }
    createDraftMock.mockReturnValue(formattedDraft)
    writeDraftFileMock.mockResolvedValue(undefined)
    const onSaving = vi.fn()
    const { gateway, useCase } = createUseCase()
    const applyGenreFormat = vi.fn(async () => "포맷됨")
    gateway.createService.mockReturnValue({ applyGenreFormat })

    const result = await useCase.execute({ ...request(), onSaving })

    expect(result.ok).toBe(true)
    expect(result.kind).toBe("formatted")
    expect(createDraftMock).toHaveBeenCalledWith({
      sceneStem: "01-arrival",
      format: "novel",
      body: "포맷됨",
      generatedAt: "2024-01-01T00:00:00.000Z",
      generator: "storyboard@0.0.0-test",
      providerId: "mock",
      model: "mock-model"
    })
    expect(applyGenreFormat).toHaveBeenCalledWith("원문", "novel", {
      providerId: "mock",
      attribution: { primary: { kind: "scene", id: "01-arrival" } }
    })
    expect(writeDraftFileMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), formattedDraft)
    expect(onSaving).toHaveBeenCalledOnce()
  })

  it("returns cancelled without saving when cancellation is requested", async () => {
    stubParsedDraft()
    const { gateway, useCase } = createUseCase()
    gateway.createService.mockReturnValue({ applyGenreFormat: vi.fn(async () => "포맷됨") })

    const result = await useCase.execute({ ...request(), shouldCancel: () => true })

    expect(result).toEqual({ kind: "cancelled", ok: false })
    expect(gateway.createService).not.toHaveBeenCalled()
    expect(writeDraftFileMock).not.toHaveBeenCalled()
  })
})
