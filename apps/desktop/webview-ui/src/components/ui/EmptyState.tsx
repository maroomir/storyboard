import type { LucideIcon } from "lucide-react"
import type React from "react"

export type EmptyStateProps = {
  readonly icon: LucideIcon
  readonly title: string
  readonly description: React.ReactNode
  readonly action?: React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-sb-border bg-sb-parchment/50 p-4">
      <Icon className="h-8 w-8 shrink-0 text-sb-fg-muted" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-display m-0 text-lg text-sb-fg">{title}</h2>
        <p className="m-0 text-sm leading-normal text-sb-fg-muted">{description}</p>
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}
