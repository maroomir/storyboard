import type React from "react"

import type { CharacterRosterEntry, StoryboardCard } from "@webview/lib/types"
import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { IconButton } from "@webview/components/ui/IconButton"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function BackgroundFields({
  card,
  updateCard,
  characterRoster
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
  readonly characterRoster?: readonly CharacterRosterEntry[]
}): React.ReactElement {
  const characterIds = card.characterIds ?? []

  return (
    <>
      {card.type === "location" ? (
        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Location Kind</span>
          <select
            className={sbInputClass}
            value={card.locationKind ?? "place"}
            onChange={(event) =>
              updateCard({ ...card, locationKind: event.target.value as "place" | "affiliation" })
            }
          >
            <option value="place">place</option>
            <option value="affiliation">affiliation</option>
          </select>
        </label>
      ) : null}

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
        <legend className="px-1 text-sm text-sb-fg-muted">Related Characters</legend>
        {characterIds.map((characterId, index) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5" key={`related-character-${index}`}>
            <select
              className={sbInputClass}
              value={characterId}
              onChange={(event) =>
                updateCard({ ...card, characterIds: replaceArrayItem(characterIds, index, event.target.value) })
              }
            >
              {characterId === "" ? <option value="">—</option> : null}
              {characterRoster?.some((entry) => entry.id === characterId) ? null : characterId !== "" ? (
                <option value={characterId}>{characterId}</option>
              ) : null}
              {characterRoster?.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <IconButton
              icon="remove"
              aria-label="삭제"
              onClick={() => updateCard({ ...card, characterIds: removeArrayItem(characterIds, index) })}
            />
          </div>
        ))}
        <IconButton
          icon="add"
          aria-label="추가"
          className="self-start"
          onClick={() => updateCard({ ...card, characterIds: [...characterIds, ""] })}
        />
      </fieldset>
    </>
  )
}
