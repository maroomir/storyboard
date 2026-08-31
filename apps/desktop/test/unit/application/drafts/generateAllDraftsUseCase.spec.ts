import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  GenerateAllDraftsUseCase,
  type ISceneBatchRepository
} from "@storyboard/story-engine"

const firstScene = vscode.Uri.file("/workspace/.storyboard/scene/01-opening.txt")
const secondScene = vscode.Uri.file("/workspace/.storyboard/scene/02-conflict.txt")
const thirdScene = vscode.Uri.file("/workspace/.storyboard/scene/03-resolution.txt")

function logger(): never {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never
}

function repository(projectCount: number, scenes: readonly vscode.Uri[]): ISceneBatchRepository {
  return { listStoryboardScenes: vi.fn(async () => ({ projectCount, scenes })) }
}

describe("GenerateAllDraftsUseCase", () => {
  it("reports when no Storyboard project is available", async () => {
    const generateDraftUseCase = { execute: vi.fn() }

    const result = await new GenerateAllDraftsUseCase(
      generateDraftUseCase as never,
      logger(),
      {} as never,
      repository(0, [])
    ).execute()

    expect(result).toEqual({ kind: "no_projects", ok: false })
    expect(generateDraftUseCase.execute).not.toHaveBeenCalled()
  })

  it("summarizes generated, cached, and failed drafts", async () => {
    const generateDraftUseCase = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ kind: "generated", ok: true, draftUri: firstScene })
        .mockResolvedValueOnce({ kind: "cache_hit", ok: true, draftUri: secondScene })
        .mockResolvedValueOnce({ kind: "failed", ok: false, message: "AI unavailable" })
    }
    const reviseAfterGenerateGate = { maybeRunAfterGenerate: vi.fn(async () => undefined) }
    const currentLogger = logger() as { error: ReturnType<typeof vi.fn> }

    const result = await new GenerateAllDraftsUseCase(
      generateDraftUseCase as never,
      currentLogger as never,
      reviseAfterGenerateGate as never,
      repository(1, [firstScene, secondScene, thirdScene])
    ).execute()

    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 1,
        failureLabels: ["03-resolution.txt: AI unavailable"],
        failures: 1,
        generated: 1,
        sceneCount: 3
      }
    })
    expect(reviseAfterGenerateGate.maybeRunAfterGenerate).toHaveBeenCalledWith(firstScene, {
      onWillRun: expect.any(Function),
      shouldCancel: undefined
    })
    expect(currentLogger.error).toHaveBeenCalledOnce()
  })

  it("stops after a cancelled draft generation", async () => {
    const generateDraftUseCase = {
      execute: vi.fn(async () => ({ kind: "cancelled", ok: false }))
    }

    const result = await new GenerateAllDraftsUseCase(
      generateDraftUseCase as never,
      logger(),
      {} as never,
      repository(1, [firstScene, secondScene])
    ).execute()

    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 0,
        failureLabels: [],
        failures: 0,
        generated: 0,
        sceneCount: 2
      }
    })
    expect(generateDraftUseCase.execute).toHaveBeenCalledOnce()
  })
})
