import clsx from "clsx"
import type React from "react"

import { formatCostBadgeLabel, formatCostBadgeTooltip, isZeroCostDisplay } from "@webview/lib/costFormat"

export type CostBadgeProps = {
  readonly usd: number
  readonly className?: string
}

export function CostBadge({ usd, className }: CostBadgeProps): React.ReactElement {
  const label = formatCostBadgeLabel(usd)
  const isPlaceholder = isZeroCostDisplay(usd)
  const tooltip = formatCostBadgeTooltip(usd)

  return (
    <span
      role="status"
      className={clsx(
        "inline-flex max-w-full items-center rounded-full border border-sb-border bg-sb-bg-sidebar/80 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums transition-colors hover:bg-sb-bg-list-hover/80",
        isPlaceholder ? "text-sb-fg-muted" : "text-sb-fg",
        className
      )}
      title={tooltip}
      aria-label={`예상 비용 ${label}`}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}
