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
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Time</span>
        <input
          className={sbInputClass}
          value={card.time ?? ""}
          onChange={(event) => {
            const value = event.target.value
            updateCard({ ...card, time: value === "" ? undefined : value })
          }}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Weather</span>
        <input
          className={sbInputClass}
          value={card.weather ?? ""}
          onChange={(event) => {
            const value = event.target.value
            updateCard({ ...card, weather: value === "" ? undefined : value })
          }}
        />
      </label>
      <ListField label="Senses" values={card.senses ?? []} onChange={(senses) => updateCard({ ...card, senses })} />
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
