import { describe, expect, it } from "vitest"

import {
  parseNovelRunState,
  serializeNovelRunState,
  type NovelRunState
} from "@storyboard/story-engine"

const state: NovelRunState = {
  version: "1.0.0",
  runId: "run-1",
  startedAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:05:00.000Z",
  runMode: "chapter-approval",
  status: "paused",
  completedStages: ["outline", "seeds"],
  nextChapterIndex: 2
}

describe("novel run state serialization", () => {
  it("round-trips through serialize and parse", () => {
    expect(parseNovelRunState(serializeNovelRunState(state))).toEqual(state)
  })

  it("applies defaults for missing optional fields", () => {
    const parsed = parseNovelRunState(
      JSON.stringify({
        version: "1.0.0",
        runId: "run-2",
        startedAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
        runMode: "auto",
        status: "running"
      })
    )

    expect(parsed.completedStages).toEqual([])
    expect(parsed.nextChapterIndex).toBe(0)
  })

  it("rejects an invalid run mode", () => {
    expect(() =>
      parseNovelRunState(JSON.stringify({ ...state, runMode: "nope" }))
    ).toThrow()
  })
})
