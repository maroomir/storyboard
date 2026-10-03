import { describe, expect, it, vi } from "vitest"

import {
  appendLedgerEntryIfNew,
  computeUsageSummaryFromEntries,
  mergeUsageLedgerEntryIntoSummary,
  parseUsageLedgerBytes,
  serializeUsageLedger,
  type UsageLedgerEntry
} from "@storyboard/story-model"

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
          total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false }
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

    expect(summary.total.costUsd).toBe(18)
    expect(summary.scenes["s1"]?.costUsd).toBeCloseTo(18)
    expect(summary.characters["c1"]?.costUsd).toBeCloseTo(12)
    expect(summary.characters["c2"]?.costUsd).toBeCloseTo(6)
  })

  it("keeps unpriced spend as tokens instead of collapsing it to zero dollars", () => {
    const summary = computeUsageSummaryFromEntries([
      entry({
        taskName: "sceneDraft",
        providerId: "codex",
        model: "gpt-5.5",
        usage: { inputTokens: 1_000, outputTokens: 500 },
        attribution: { primary: { kind: "scene", id: "s1" } }
      }),
      entry({
        id: "id-2",
        taskName: "sceneDraft",
        providerId: "openai",
        model: "gpt-5-mini",
        usage: { inputTokens: 100, outputTokens: 100 },
        costUsd: 0.25,
        attribution: { primary: { kind: "scene", id: "s1" } }
      })
    ])

    expect(summary.total).toEqual({ costUsd: 0.25, tokens: 1_700, hasUnpricedUsage: true })
    expect(summary.scenes["s1"]).toEqual({ costUsd: 0.25, tokens: 1_700, hasUnpricedUsage: true })
  })

  it("parses legacy ledger entries that still carry costUsd 0 as priced", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "legacy",
            recordedAt: "2026-01-01T00:00:00.000Z",
            taskName: "sceneDraft",
            providerId: "claude",
            usage: { inputTokens: 10, outputTokens: 10 },
            costUsd: 0,
            attribution: {}
          }
        ]
      })
    )

    expect(computeUsageSummaryFromEntries(parseUsageLedgerBytes(bytes)).total).toEqual({
      costUsd: 0,
      tokens: 20,
      hasUnpricedUsage: false
    })
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
