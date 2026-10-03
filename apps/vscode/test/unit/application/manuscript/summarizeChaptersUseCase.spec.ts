import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  SummarizeChaptersUseCase,
  type IChapterSummaryRepository
} from "@storyboard/story-engine"
import type { ChapterPlan } from '@storyboard/story-model';

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
          scenes: [{ id: "opening", title: "시작", purpose: "", characters: [], foreshadowing: [] }]
        }
      ]
    }
  ]
}

function repository(hasChapterPlan: boolean): IChapterSummaryRepository {
  return {
    hasChapterPlan: vi.fn(async () => hasChapterPlan),
    loadAssemblySource: vi.fn(async () => ({
      projectName: "테스트",
      plan,
      draftsByOrder: new Map([[1, { stem: "01-opening", body: "본문" }]])
    })),
    saveChapterSummaries: vi.fn(async () =>
      vscode.Uri.file("/workspace/manuscript/CHAPTER_SUMMARIES.md")
    )
  }
}

function useCase(
  repository: IChapterSummaryRepository,
  summarizeChapter = vi.fn(async () => "요약")
): SummarizeChaptersUseCase {
  return new SummarizeChaptersUseCase({
    aiGateway: {
      createService: () => ({ summarizeChapter }),
      getTaskProvider: () => "mock"
    } as never,
    repository,
    logger: { error: vi.fn() } as never
  })
}

describe("SummarizeChaptersUseCase", () => {
  it("reports a missing outline before calling AI", async () => {
    const storage = repository(false)

    await expect(useCase(storage).execute({ workspaceRoot: vscode.Uri.file("/workspace") })).resolves.toEqual({
      kind: "missing_outline",
      ok: false
    })
  })

  it("summarizes assembled chapters and writes one markdown document", async () => {
    const storage = repository(true)
    const onProgress = vi.fn()

    const result = await useCase(storage).execute({ workspaceRoot: vscode.Uri.file("/workspace"), onProgress })

    expect(result).toEqual(
      expect.objectContaining({ kind: "summarized", ok: true, summaryCount: 1 })
    )
    expect(onProgress).toHaveBeenCalledWith(1, 1)
    expect(storage.saveChapterSummaries).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("요약")
    )
  })
})
