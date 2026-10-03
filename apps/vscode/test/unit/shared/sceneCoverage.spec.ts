import { describe, expect, it } from "vitest"

import { coerceSceneCoverage, summarizeSceneCoverage } from '@storyboard/story-model';
import type { SceneCoverageIssue } from '@storyboard/story-model';

describe("coerceSceneCoverage", () => {
  it("parses a JSON array of valid issues with optional notes", () => {
    const issues = coerceSceneCoverage(
      '[{"index":1,"status":"missing","note":"문 여는 장면이 빠짐"},{"index":2,"status":"out-of-order"}]',
      3
    )

    expect(issues).toEqual([
      { index: 1, status: "missing", note: "문 여는 장면이 빠짐" },
      { index: 2, status: "out-of-order" }
    ])
  })

  it("drops items whose index exceeds the beat count", () => {
    const issues = coerceSceneCoverage('[{"index":2,"status":"missing"},{"index":5,"status":"missing"}]', 3)

    expect(issues).toEqual([{ index: 2, status: "missing" }])
  })

  it("drops items with invalid or missing fields", () => {
    const issues = coerceSceneCoverage(
      '[{"index":1,"status":"unknown"},{"status":"missing"},{"index":0,"status":"missing"},{"index":2,"status":"out-of-order"}]',
      3
    )

    expect(issues).toEqual([{ index: 2, status: "out-of-order" }])
  })

  it("dedupes items that share the same index and status", () => {
    const issues = coerceSceneCoverage(
      '[{"index":1,"status":"missing"},{"index":1,"status":"missing","note":"중복"}]',
      3
    )

    expect(issues).toEqual([{ index: 1, status: "missing" }])
  })

  it("keeps the same index when the status differs", () => {
    const issues = coerceSceneCoverage(
      '[{"index":1,"status":"missing"},{"index":1,"status":"out-of-order"}]',
      3
    )

    expect(issues).toEqual([
      { index: 1, status: "missing" },
      { index: 1, status: "out-of-order" }
    ])
  })

  it("returns an empty array for non-array or garbage text", () => {
    expect(coerceSceneCoverage("문제 없음", 3)).toEqual([])
    expect(coerceSceneCoverage('{"index":1,"status":"missing"}', 3)).toEqual([])
    expect(coerceSceneCoverage("", 3)).toEqual([])
  })
})

describe("summarizeSceneCoverage", () => {
  it("partitions issues into missing and out-of-order sorted ascending", () => {
    const issues: SceneCoverageIssue[] = [
      { index: 3, status: "missing" },
      { index: 1, status: "out-of-order" },
      { index: 2, status: "missing" },
      { index: 4, status: "out-of-order" }
    ]

    const report = summarizeSceneCoverage(issues, 5)

    expect(report.missing).toEqual([2, 3])
    expect(report.outOfOrder).toEqual([1, 4])
  })

  it("computes coveredRatio from total beats minus missing beats", () => {
    const report = summarizeSceneCoverage(
      [
        { index: 2, status: "missing" },
        { index: 3, status: "out-of-order" }
      ],
      4
    )

    expect(report.coveredRatio).toBe(0.75)
    expect(report.totalBeats).toBe(4)
  })

  it("treats zero total beats as fully covered", () => {
    const report = summarizeSceneCoverage([], 0)

    expect(report.coveredRatio).toBe(1)
    expect(report.missing).toEqual([])
    expect(report.outOfOrder).toEqual([])
  })

  it("reports full coverage when there are no issues", () => {
    const report = summarizeSceneCoverage([], 3)

    expect(report).toEqual({ totalBeats: 3, missing: [], outOfOrder: [], coveredRatio: 1 })
  })
})
