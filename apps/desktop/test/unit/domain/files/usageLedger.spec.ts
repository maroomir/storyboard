import { describe, expect, it, vi } from "vitest"

import {
  appendLedgerEntryIfNew,
  computeUsageSummaryFromEntries,
  mergeUsageLedgerEntryIntoSummary,
  parseUsageLedgerBytes,
  serializeUsageLedger,
  type UsageLedgerEntry
} from "@storyboard/story-engine"

function entry(partial: Omit<UsageLedgerEntry, "id" | "recordedAt"> & { readonly id?: string; readonly recordedAt?: string }): UsageLedgerEntry {
  return {
    id: partial.id ?? "id-1",
    recordedAt: partial.recordedAt ?? "2026-01-01T00:00:00.000Z",
    taskName: partial.taskName,
    providerId: partial.providerId,
    model: partial.model,
    usage: partial.usage,
    costUsd: partial.costUsd,
    attribution: partial.attribution
  }
}

describe("usageLedger", () => {
  it("merges primary and equal participant shares", () => {
    const summary = mergeUsageLedgerEntryIntoSummary(
      mergeUsageLedgerEntryIntoSummary(
        {
          scenes: {},
          characters: {},
          backgrounds: {},
          totalUsd: 0
        },
        entry({
          taskName: "personaDialogue",
          providerId: "mock",
          costUsd: 12,
          attribution: {
            primary: { kind: "scene", id: "s1" },
            participants: [
              { kind: "character", id: "c1" },
              { kind: "character", id: "c2" }
            ]
          }
        })
      ),
      entry({
        id: "id-2",
        taskName: "traitsExtraction",
        providerId: "mock",
        costUsd: 6,
        attribution: {
          primary: { kind: "character", id: "c1" },
          participants: [{ kind: "scene", id: "s1" }]
        }
      })
    )

    expect(summary.totalUsd).toBe(18)
    expect(summary.scenes["s1"]).toBeCloseTo(18)
    expect(summary.characters["c1"]).toBeCloseTo(12)
    expect(summary.characters["c2"]).toBeCloseTo(6)
  })

  it("roundtrips ledger JSON and recomputes summary", () => {
    const entries: UsageLedgerEntry[] = [
      entry({
        id: "a",
        taskName: "sceneDraft",
        providerId: "openai",
        costUsd: 1,
        attribution: { primary: { kind: "scene", id: "stem" } }
      })
    ]

    const bytes = serializeUsageLedger(entries)
    const parsed = parseUsageLedgerBytes(bytes)
    expect(parsed).toHaveLength(1)
    expect(computeUsageSummaryFromEntries(parsed)).toEqual(computeUsageSummaryFromEntries(entries))
  })

  it("warns and returns empty entries for invalid JSON", () => {
    const warn = vi.fn()
    const parsed = parseUsageLedgerBytes(new TextEncoder().encode("{"), warn)

    expect(parsed).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it("skips append when entry id already exists", () => {
    const first = entry({ id: "dup", taskName: "inlineCompletion", providerId: "mock", costUsd: 1, attribution: {} })
    const second = entry({
      id: "dup",
      taskName: "inlineCompletion",
      providerId: "mock",
      costUsd: 2,
      attribution: { primary: { kind: "scene", id: "x" } }
    })

    const { entries, appended } = appendLedgerEntryIfNew([first], second)

    expect(appended).toBe(false)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.costUsd).toBe(1)
  })
})
