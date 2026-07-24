import clsx from "clsx"
import type { LucideIcon } from "lucide-react"
import type React from "react"

export type PillTone = "character" | "background" | "neutral"

const toneClass: Record<PillTone, string> = {
  character: "border-sb-accent-character/40 bg-sb-accent-character/15 text-sb-fg",
  background: "border-sb-accent-background/40 bg-sb-accent-background/15 text-sb-fg",
  neutral: "border-sb-border bg-sb-bg-widget text-sb-fg-muted"
}

export type PillProps = {
  readonly children: React.ReactNode
  readonly tone?: PillTone
  readonly className?: string
  readonly icon?: LucideIcon
}

export function Pill({ children, tone = "neutral", className, icon: Icon }: PillProps): React.ReactElement {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        toneClass[tone],
        className
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0 opacity-90" aria-hidden /> : null}
      {children}
    </span>
  )
}
