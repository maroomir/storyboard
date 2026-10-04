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

    const result = await new GenerateAllDraftsUseCase({
      generateDraftUseCase: generateDraftUseCase as never,
      logger: logger(),
      reviseAfterGenerateGate: {} as never,
      sceneRepository: repository(0, [])
    }).execute()

    expect(result).toEqual({ kind: "no_projects", ok: false })
    expect(generateDraftUseCase.execute).not.toHaveBeenCalled()
  })

  it("summarizes generated, cached, and failed drafts", async () => {
    const generateDraftUseCase = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ kind: "generated", ok: true, draftUri: firstScene, warnings: ["1구간: 목표 3,000자에 크게 못 미칩니다"] })
        .mockResolvedValueOnce({ kind: "cache_hit", ok: true, draftUri: secondScene })
        .mockResolvedValueOnce({ kind: "failed", ok: false, message: "AI unavailable" })
    }
    const reviseAfterGenerateGate = { maybeRunAfterGenerate: vi.fn(async () => undefined) }
    const currentLogger = logger() as { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

    const result = await new GenerateAllDraftsUseCase({
      generateDraftUseCase: generateDraftUseCase as never,
      logger: currentLogger as never,
      reviseAfterGenerateGate: reviseAfterGenerateGate as never,
      sceneRepository: repository(1, [firstScene, secondScene, thirdScene])
    }).execute()

    // 무인 배치에서는 초안 앞머리의 경고를 아무도 열어보지 않는다.
    expect(currentLogger.warn).toHaveBeenCalledWith(
      "01-opening.txt: 1구간: 목표 3,000자에 크게 못 미칩니다"
    )
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

    const result = await new GenerateAllDraftsUseCase({
      generateDraftUseCase: generateDraftUseCase as never,
      logger: logger(),
      reviseAfterGenerateGate: {} as never,
      sceneRepository: repository(1, [firstScene, secondScene])
    }).execute()

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

  it("pauses between scenes and reports the scenes it did not reach", async () => {
    let isPauseRequested = false
    const generateDraftUseCase = {
      execute: vi.fn(async () => {
        isPauseRequested = true
        return { kind: "cache_hit", ok: true, draftUri: firstScene }
      })
    }

    const result = await new GenerateAllDraftsUseCase({
      generateDraftUseCase: generateDraftUseCase as never,
      logger: logger(),
      reviseAfterGenerateGate: {} as never,
      sceneRepository: repository(1, [firstScene, secondScene, thirdScene])
    }).execute({ shouldPause: () => isPauseRequested })

    expect(generateDraftUseCase.execute).toHaveBeenCalledOnce()
    expect(result).toEqual({
      kind: "completed",
      ok: true,
      summary: {
        cacheHits: 1,
        failureLabels: [],
        failures: 0,
        generated: 0,
        sceneCount: 3,
        pausedWithRemaining: 2
      }
    })
  })
})
