import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  AssembleManuscriptUseCase,
  type IManuscriptAssemblyRepository
} from "@/application/manuscript/assembleManuscriptUseCase"
import type { ChapterPlan } from '@storyboard/story-format';

const plan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "발단",
      chapters: [
        {
          id: "chapter-1",
          title: "1장",
          scenes: [
            { id: "opening", title: "시작", purpose: "", characters: [], foreshadowing: ["반지"] }
          ]
        }
      ]
    }
  ]
}

function repository(hasChapterPlan: boolean, draftCount: number): IManuscriptAssemblyRepository {
  return {
    hasChapterPlan: vi.fn(async () => hasChapterPlan),
    loadAssemblySource: vi.fn(async () => ({
      projectName: "테스트",
      plan,
      draftsByOrder:
        draftCount > 0 ? new Map([[1, { stem: "01-opening", body: "본문" }]]) : new Map()
    })),
    saveAssembly: vi.fn(async () => vscode.Uri.file("/workspace/manuscript/VOLUME.md"))
  }
}

function useCase(repository: IManuscriptAssemblyRepository): AssembleManuscriptUseCase {
  return new AssembleManuscriptUseCase({ warn: vi.fn() } as never, repository)
}

describe("AssembleManuscriptUseCase", () => {
  it("reports a missing chapter plan before loading source files", async () => {
    const storage = repository(false, 1)

    await expect(useCase(storage).execute(vscode.Uri.file("/workspace"))).resolves.toEqual({
      kind: "missing_outline",
      ok: false
    })
    expect(storage.loadAssemblySource).not.toHaveBeenCalled()
  })

  it("assembles drafts and persists chapter, volume, and foreshadowing output together", async () => {
    const storage = repository(true, 1)

    const result = await useCase(storage).execute(vscode.Uri.file("/workspace"))

    expect(result).toEqual(
      expect.objectContaining({
        kind: "assembled",
        ok: true,
        result: expect.objectContaining({
          chapterCount: 1,
          foreshadowingCount: 1,
          includedCount: 1
        })
      })
    )
    expect(storage.saveAssembly).toHaveBeenCalledOnce()
  })
})
