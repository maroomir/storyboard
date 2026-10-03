import { describe, expect, it } from "vitest"

import {
  RevisionPlanParseError,
  createEmptyRevisionPlan,
  parseRevisionPlan,
  serializeRevisionPlan,
  upsertRevisionEntry,
  type RevisionPlanEntry
} from "@storyboard/story-model"

const entry = (sceneStem: string, remainingBlocking: number): RevisionPlanEntry => ({
  sceneStem,
  checkedAt: "2026-06-20T00:00:00.000Z",
  revisionCount: 1,
  remainingBlocking,
  instructions: remainingBlocking > 0 ? ["설정 모순: x — y"] : []
})

describe("revision plan serialization", () => {
  it("round-trips through serialize and parse", () => {
    const plan = upsertRevisionEntry(createEmptyRevisionPlan(), entry("01-prologue", 0))
    expect(parseRevisionPlan(serializeRevisionPlan(plan))).toEqual(plan)
  })

  it("throws on invalid yaml", () => {
    expect(() => parseRevisionPlan(":\n  - [")).toThrow(RevisionPlanParseError)
  })
})

describe("upsertRevisionEntry", () => {
  it("replaces an existing scene entry and keeps entries sorted", () => {
    let plan = createEmptyRevisionPlan()
    plan = upsertRevisionEntry(plan, entry("02-chapter", 2))
    plan = upsertRevisionEntry(plan, entry("01-prologue", 1))
    plan = upsertRevisionEntry(plan, entry("02-chapter", 0))

    expect(plan.entries.map((item) => item.sceneStem)).toEqual(["01-prologue", "02-chapter"])
    expect(plan.entries[1]?.remainingBlocking).toBe(0)
    expect(plan.entries[1]?.instructions).toEqual([])
  })
})
