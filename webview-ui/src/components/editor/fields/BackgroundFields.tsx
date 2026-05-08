import type React from "react"

import type { StoryboardCard } from "@webview/lib/types"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function BackgroundFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Concept</span>
        <input
          className={sbInputClass}
          value={card.concept ?? ""}
          onChange={(event) => updateCard({ ...card, concept: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Country</span>
        <input
          className={sbInputClass}
          value={card.country ?? ""}
          onChange={(event) => updateCard({ ...card, country: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Category</span>
        <input
          className={sbInputClass}
          value={card.category ?? ""}
          onChange={(event) => updateCard({ ...card, category: event.target.value })}
        />
      </label>
    </>
  )
}
