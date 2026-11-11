import { describe, expect, it, vi } from "vitest"

import { ChapterSummaryRefresher } from "@storyboard/story-engine"
import type { ChapterSummary } from "@storyboard/story-model"
import { createTestAi, createTestHost, createTestRepositories } from "@storyboard/story-engine/testing"

const plan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "1막",
      chapters: [
        { id: "c1", title: "1장", scenes: [{ id: "s1", title: "씬1", purpose: "", characters: [], foreshadowing: [] }] },
        { id: "c2", title: "2장", scenes: [{ id: "s2", title: "씬2", purpose: "", characters: [], foreshadowing: [] }] },
        { id: "c3", title: "3장", scenes: [{ id: "s3", title: "씬3", purpose: "", characters: [], foreshadowing: [] }] }
      ]
    }
  ]
}

function refresherWith(stored: ChapterSummary[]): {
  readonly refresher: ChapterSummaryRefresher
  readonly summarized: string[]
  readonly saved: (readonly ChapterSummary[])[]
} {
  const summarized: string[] = []
  const saved: (readonly ChapterSummary[])[] = []
  const repositories = createTestRepositories({
    chapterSummaries: {
      hasChapterPlan: async (): Promise<boolean> => true,
      loadAssemblySource: async (): Promise<unknown> => ({
        projectName: "작품",
        plan,
        draftsByOrder: new Map([
          [1, { stem: "001-s1", body: "1장 본문" }],
          [2, { stem: "002-s2", body: "2장 본문" }]
        ])
      }),
      readChapterSummaries: async (): Promise<ChapterSummary[]> => stored,
      saveChapterSummaries: async (_root: unknown, summaries: readonly ChapterSummary[]): Promise<void> => {
        saved.push(summaries)
      }
    } as never
  })
  const ai = createTestAi({
    gateway: {
      createService: () => ({
        summarizeChapter: vi.fn(async ({ chapterTitle }: { chapterTitle: string }) => {
          summarized.push(chapterTitle)
          return `${chapterTitle} 요약`
        })
      }),
      getTaskProvider: () => "mock"
    } as never
  })
  const host = createTestHost({ logger: { error: vi.fn() } as never })

  return { refresher: new ChapterSummaryRefresher({ host, ai, repositories }), summarized, saved }
}

describe("ChapterSummaryRefresher", () => {
  it("lists the written chapters that have no summary", async () => {
    const { refresher } = refresherWith([{ chapterTitle: "1장", summary: "있음" }])

    expect(await refresher.listMissing({} as never)).toEqual(["2장"])
    expect(await refresher.listMissing({} as never, 2)).toEqual([])
    expect(await refresher.listMissing({} as never, 3)).toEqual(["2장"])
  })

  it("summarizes the missing chapters before the scene and leaves the rest", async () => {
    const { refresher, summarized, saved } = refresherWith([])

    expect(await refresher.refreshBefore({} as never, 3)).toBe(2)
    expect(summarized).toEqual(["1장", "2장"])
    expect(saved).toHaveLength(2)
  })

  it("calls nothing when every chapter before the scene is summarized", async () => {
    const { refresher, summarized } = refresherWith([
      { chapterTitle: "1장", summary: "있음" },
      { chapterTitle: "2장", summary: "있음" }
    ])

    expect(await refresher.refreshBefore({} as never, 3)).toBe(0)
    expect(summarized).toEqual([])
  })
})
