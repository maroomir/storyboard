import type React from "react"

import type { StoryboardCard } from "@webview/lib/types"
import { sbInputClass } from "@webview/components/ui/formClasses"
import { ListField } from "./ListField"

export function BackgroundFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <ListField label="Aliases" values={card.aliases ?? []} onChange={(aliases) => updateCard({ ...card, aliases })} />
      {card.type === "location" ? (
        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Location Kind</span>
          <select
            className={sbInputClass}
            value={card.locationKind ?? "place"}
            onChange={(event) => updateCard({ ...card, locationKind: event.target.value as "place" | "affiliation" })}
          >
            <option value="place">place</option>
            <option value="affiliation">affiliation</option>
          </select>
        </label>
      ) : null}
    </>
  )
}
