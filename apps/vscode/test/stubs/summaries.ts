import type { ChapterSummaryLedger } from "@storyboard/story-engine"
import type { ChapterSummary } from "@storyboard/story-model"

export function stubSummaries(markdown?: string): ChapterSummaryLedger {
  return {
    read: async (): Promise<ChapterSummary[]> => [],
    write: async (): Promise<void> => undefined,
    readMarkdown: async (): Promise<string | undefined> => markdown
  } as unknown as ChapterSummaryLedger
}

export function memorySummaries(): ChapterSummaryLedger & { readonly rows: Map<string, ChapterSummary[]> } {
  const rows: Map<string, ChapterSummary[]> = new Map()
  return {
    rows,
    read: async (_root: unknown, threadId: string): Promise<ChapterSummary[]> => [...(rows.get(threadId) ?? [])],
    write: async (_root: unknown, threadId: string, summaries: readonly ChapterSummary[]): Promise<void> => {
      rows.set(threadId, summaries.filter((summary) => summary.isStale !== true))
    },
    readMarkdown: async (): Promise<string | undefined> => undefined
  } as unknown as ChapterSummaryLedger & { readonly rows: Map<string, ChapterSummary[]> }
}
