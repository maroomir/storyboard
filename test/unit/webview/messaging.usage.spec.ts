import { describe, expect, it } from "vitest"

import {
  parseUsageChangedPayload,
  sumUsageMap
} from "@webview/lib/messaging"

describe("parseUsageChangedPayload", () => {
  it("reads flat usage.read-shaped payloads", () => {
    const payload = {
      scenes: { s1: 0.1 },
      characters: {},
      backgrounds: {},
      totalUsd: 0.1
    }
    expect(parseUsageChangedPayload(payload)).toEqual(payload)
  })

  it("does not expect a nested summary property", () => {
    expect(parseUsageChangedPayload({ summary: { totalUsd: 1 } })).toMatchObject({
      totalUsd: 0
    })
  })
})

describe("sumUsageMap", () => {
  it("sums finite numeric values", () => {
    expect(sumUsageMap({ a: 0.01, b: 0.02 })).toBeCloseTo(0.03)
  })

  it("ignores non-finite entries", () => {
    expect(sumUsageMap({ a: 1, b: Number.NaN })).toBe(1)
  })
})
