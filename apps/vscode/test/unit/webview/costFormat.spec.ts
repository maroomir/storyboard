import { describe, expect, it } from "vitest"

import {
  formatTokenCount,
  formatUsageBadgeLabel,
  formatUsageBadgeTooltip,
  isEmptyUsageDisplay
} from "@webview/lib/costFormat"

const empty = { costUsd: 0, tokens: 0, hasUnpricedUsage: false }

describe("formatTokenCount", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokenCount(850)).toBe("850")
    expect(formatTokenCount(12_300)).toBe("12.3k")
    expect(formatTokenCount(1_000)).toBe("1k")
    expect(formatTokenCount(2_500_000)).toBe("2.5M")
  })
})

describe("formatUsageBadgeLabel", () => {
  it("uses a dash placeholder when nothing was used", () => {
    expect(formatUsageBadgeLabel(empty)).toBe("—")
    expect(formatUsageBadgeLabel({ ...empty, costUsd: -2 })).toBe("—")
  })

  it("shows dollars and tokens for priced usage", () => {
    expect(formatUsageBadgeLabel({ costUsd: 1.234, tokens: 12_300, hasUnpricedUsage: false })).toBe(
      "$1.23 · 12.3k"
    )
    expect(formatUsageBadgeLabel({ costUsd: 0.005, tokens: 40, hasUnpricedUsage: false })).toBe(
      "$0.005 · 40"
    )
  })

  it("shows dollars alone when tokens were not reported", () => {
    expect(formatUsageBadgeLabel({ costUsd: 0.01, tokens: 0, hasUnpricedUsage: false })).toBe("$0.01")
  })

  it("leads with tokens for subscription usage that has no price", () => {
    expect(formatUsageBadgeLabel({ costUsd: 0, tokens: 12_300, hasUnpricedUsage: true })).toBe(
      "12.3k 토큰"
    )
  })

  it("shows both when priced and unpriced usage are mixed", () => {
    expect(formatUsageBadgeLabel({ costUsd: 0.42, tokens: 12_300, hasUnpricedUsage: true })).toBe(
      "$0.42 · 12.3k"
    )
  })
})

describe("formatUsageBadgeTooltip", () => {
  it("describes empty usage", () => {
    expect(formatUsageBadgeTooltip(empty)).toBe("아직 AI 사용 기록이 없습니다")
  })

  it("shows six decimal places, token counts and the unpriced note", () => {
    expect(
      formatUsageBadgeTooltip({ costUsd: 0.0123456, tokens: 1_234, hasUnpricedUsage: true })
    ).toBe("USD 0.012346 · 입력+출력 1,234 토큰 · 구독형 프로바이더 사용분은 달러로 환산되지 않습니다")
  })
})

describe("isEmptyUsageDisplay", () => {
  it("is true only when both dollars and tokens are zero", () => {
    expect(isEmptyUsageDisplay(empty)).toBe(true)
    expect(isEmptyUsageDisplay({ ...empty, tokens: 1 })).toBe(false)
    expect(isEmptyUsageDisplay({ ...empty, costUsd: 0.0001 })).toBe(false)
  })
})
