export function formatCostBadgeLabel(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) {
    return "$0.00"
  }

  if (usd >= 0.01) {
    return `$${usd.toFixed(2)}`
  }

  const raw = usd.toFixed(4)
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "")
  return `$${trimmed}`
}

export function formatCostBadgeTooltip(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) {
    return "비용 없음"
  }

  return `USD ${usd.toFixed(6)}`
}

export function isZeroCostDisplay(usd: number): boolean {
  return !Number.isFinite(usd) || usd <= 0
}
