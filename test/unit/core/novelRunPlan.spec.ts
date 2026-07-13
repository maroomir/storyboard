import { describe, expect, it } from "vitest"

import { isResumable, planRemainingStages } from "@/core/novelRunPlan"
import type { NovelRunState } from "@/domain/files/novelRunState"

const baseState: NovelRunState = {
  version: "1.0.0",
  runId: "run-1",
  startedAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  runMode: "auto",
  status: "paused",
  completedStages: [],
  nextChapterIndex: 0
}

describe("planRemainingStages", () => {
  it("returns all stages for a fresh run", () => {
    const plan = planRemainingStages(undefined, 3)
    expect(plan.stages).toEqual(["outline", "seeds", "chapters", "assemble", "review", "summaries"])
    expect(plan.startChapterIndex).toBe(0)
  })

  it("skips completed stages and resumes chapters at nextChapterIndex", () => {
    const plan = planRemainingStages(
      { ...baseState, completedStages: ["outline", "seeds"], nextChapterIndex: 2 },
      5
    )
    expect(plan.stages).toEqual(["chapters", "assemble", "review", "summaries"])
    expect(plan.startChapterIndex).toBe(2)
  })

  it("treats the chapters stage as finished once completed", () => {
    const plan = planRemainingStages(
      { ...baseState, completedStages: ["outline", "seeds", "chapters"], nextChapterIndex: 5 },
      5
    )
    expect(plan.stages).toEqual(["assemble", "review", "summaries"])
    expect(plan.startChapterIndex).toBe(5)
  })
})

describe("isResumable", () => {
  it("is true only for paused or failed states", () => {
    expect(isResumable(undefined)).toBe(false)
    expect(isResumable({ ...baseState, status: "paused" })).toBe(true)
    expect(isResumable({ ...baseState, status: "failed" })).toBe(true)
    expect(isResumable({ ...baseState, status: "done" })).toBe(false)
    expect(isResumable({ ...baseState, status: "running" })).toBe(false)
  })
})
