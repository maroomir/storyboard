import type React from "react"

import type { CharacterRole, StoryboardCard } from "@webview/lib/types"
import { CHARACTER_ROLE_OPTIONS } from "@webview/lib/characterSidebarGroups"
import { sbInputClass } from "@webview/components/ui/formClasses"
import { ListField } from "./ListField"

export function CharacterFields({
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
        <span className="text-sm text-sb-fg-muted">Role</span>
        <select
          className={sbInputClass}
          value={card.role ?? ""}
          onChange={(event) => {
            const value = event.target.value
            if (value === "") {
              updateCard({ ...card, role: undefined })
              return
            }

            updateCard({ ...card, role: value as CharacterRole })
          }}
        >
          <option value="">—</option>
          {CHARACTER_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ListField label="Voice" values={card.voice ?? []} onChange={(voice) => updateCard({ ...card, voice })} />
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Profile</span>
        <input
          className={sbInputClass}
          value={card.profile ?? ""}
          onChange={(event) => updateCard({ ...card, profile: event.target.value })}
        />
      </label>
    </>
  )
}
