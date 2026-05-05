import type React from "react"

import type { StoryboardCard } from "../../../lib/types"
import { sbInputClass } from "../../ui/formClasses"

export function CharacterFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Role</span>
        <input
          className={sbInputClass}
          value={card.role ?? ""}
          onChange={(event) => updateCard({ ...card, role: event.target.value })}
        />
      </label>
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
