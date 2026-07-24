import { describe, expect, it } from "vitest"

import {
  formatCostBadgeLabel,
  formatCostBadgeTooltip,
  isZeroCostDisplay
} from "@webview/lib/costFormat"

describe("formatCostBadgeLabel", () => {
  it("uses placeholder for non-positive and non-finite", () => {
    expect(formatCostBadgeLabel(0)).toBe("$0.00")
    expect(formatCostBadgeLabel(-2)).toBe("$0.00")
    expect(formatCostBadgeLabel(Number.NaN)).toBe("$0.00")
  })

  it("uses two decimals when at least one cent", () => {
    expect(formatCostBadgeLabel(0.01)).toBe("$0.01")
    expect(formatCostBadgeLabel(1.234)).toBe("$1.23")
    expect(formatCostBadgeLabel(10)).toBe("$10.00")
  })

  it("uses fractional cents with up to four decimal places", () => {
    expect(formatCostBadgeLabel(0.005)).toBe("$0.005")
    expect(formatCostBadgeLabel(0.0001)).toBe("$0.0001")
  })
})

describe("formatCostBadgeTooltip", () => {
  it("describes zero cost", () => {
    expect(formatCostBadgeTooltip(0)).toBe("비용 없음")
  })

  it("shows six decimal places for positive amounts", () => {
    expect(formatCostBadgeTooltip(0.0123456)).toBe("USD 0.012346")
  })
})

describe("isZeroCostDisplay", () => {
  it("is true for zero-like values", () => {
    expect(isZeroCostDisplay(0)).toBe(true)
    expect(isZeroCostDisplay(Number.NaN)).toBe(true)
  })

  it("is false for positive amounts", () => {
    expect(isZeroCostDisplay(0.0001)).toBe(false)
  })
})
