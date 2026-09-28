import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { ExpandDraftUseCase } from "@storyboard/story-engine"

function createUseCase(): {
  gateway: { createService: ReturnType<typeof vi.fn>; getTaskProvider: ReturnType<typeof vi.fn> }
  logger: { error: ReturnType<typeof vi.fn> }
  useCase: ExpandDraftUseCase
} {
  const gateway = {
    createService: vi.fn(),
    getTaskProvider: vi.fn(() => "mock")
  }
  const logger = { error: vi.fn() }

  return {
    gateway,
    logger,
    useCase: new ExpandDraftUseCase({ aiGateway: gateway as never, logger: logger as never })
  }
}

function request(): Parameters<ExpandDraftUseCase["execute"]>[0] {
  return {
    workspaceRoot: vscode.Uri.file("/workspace"),
    selectedText: "선택한 문장",
    sceneStem: "01-arrival"
  }
}

describe("ExpandDraftUseCase", () => {
  it("returns failed and logs when the AI expand call throws", async () => {
    const { gateway, logger, useCase } = createUseCase()
    gateway.createService.mockReturnValue({
      expandDraft: vi.fn(async () => {
        throw new Error("ai down")
      })
    })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "failed", message: "ai down", ok: false })
    expect(logger.error).toHaveBeenCalledWith("Expand draft failed", expect.any(Error))
  })

  it("returns empty when the expansion result is blank", async () => {
    const { gateway, useCase } = createUseCase()
    gateway.createService.mockReturnValue({ expandDraft: vi.fn(async () => "") })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "empty", ok: false })
  })

  it("returns expanded text and forwards provider and attribution on success", async () => {
    const { gateway, useCase } = createUseCase()
    const expandDraft = vi.fn(async () => "확장된 문장")
    gateway.createService.mockReturnValue({ expandDraft })

    const result = await useCase.execute(request())

    expect(result).toEqual({ kind: "expanded", ok: true, text: "확장된 문장" })
    expect(expandDraft).toHaveBeenCalledWith(
      "선택한 문장",
      {},
      {
        providerId: "mock",
        attribution: { primary: { kind: "scene", id: "01-arrival" } }
      }
    )
  })
})
