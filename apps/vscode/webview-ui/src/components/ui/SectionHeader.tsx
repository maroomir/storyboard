import type React from "react"

export type SectionHeaderProps = {
  readonly eyebrow?: string
  readonly title: string
  readonly description?: React.ReactNode
}

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps): React.ReactElement {
  return (
    <header className="flex flex-col gap-1">
      {eyebrow ? <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">{eyebrow}</p> : null}
      <h2 className="font-display m-0 text-lg leading-snug text-sb-fg">{title}</h2>
      {description ? <div className="text-sm text-sb-fg-muted">{description}</div> : null}
    </header>
  )
}
