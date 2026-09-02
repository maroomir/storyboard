import { describe, expect, it } from "vitest"

import { parseUsageChangedPayload, sumUsageMap, usageAmountOf } from "@webview/lib/messaging"

const priced = { costUsd: 0.1, tokens: 1_000, hasUnpricedUsage: false }
const unpriced = { costUsd: 0, tokens: 2_000, hasUnpricedUsage: true }

describe("parseUsageChangedPayload", () => {
  it("reads flat usage.read-shaped payloads", () => {
    const payload = {
      scenes: { s1: priced },
      characters: {},
      backgrounds: {},
      total: priced
    }
    expect(parseUsageChangedPayload(payload)).toEqual(payload)
  })

  it("drops malformed amounts and falls back to an empty total", () => {
    expect(
      parseUsageChangedPayload({ scenes: { s1: { costUsd: "x" } }, summary: { total: 1 } })
    ).toEqual({
      scenes: {},
      characters: {},
      backgrounds: {},
      total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false }
    })
  })
})

describe("sumUsageMap", () => {
  it("adds dollars and tokens and keeps the unpriced flag", () => {
    expect(sumUsageMap({ a: priced, b: unpriced })).toEqual({
      costUsd: 0.1,
      tokens: 3_000,
      hasUnpricedUsage: true
    })
  })

  it("returns an empty amount for an empty map", () => {
    expect(sumUsageMap({})).toEqual({ costUsd: 0, tokens: 0, hasUnpricedUsage: false })
  })
})

describe("usageAmountOf", () => {
  it("returns an empty amount for an unknown key", () => {
    expect(usageAmountOf({ a: priced }, "b")).toEqual({
      costUsd: 0,
      tokens: 0,
      hasUnpricedUsage: false
    })
  })
})
