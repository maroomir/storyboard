import type React from "react"

import { CharacterRelationPreview } from "@webview/components/character/CharacterRelationPreview"
import type { CharacterRelation } from "@webview/lib/types"
import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { IconButton } from "@webview/components/ui/IconButton"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function RelationsField({
  characterId,
  characterName,
  relations,
  onChange
}: {
  readonly characterId: string
  readonly characterName: string
  readonly relations: readonly CharacterRelation[]
  readonly onChange: (relations: CharacterRelation[]) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <CharacterRelationPreview characterId={characterId} characterName={characterName} relations={relations} />
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
        <legend className="px-1 text-sm text-sb-fg-muted">Relations</legend>
        {relations.map((relation, index) => (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5" key={`relation-${index}`}>
            <input
              className={sbInputClass}
              placeholder="target"
              value={relation.target}
              onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, target: event.target.value }))}
            />
            <input
              className={sbInputClass}
              placeholder="type"
              value={relation.type}
              onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, type: event.target.value }))}
            />
            <IconButton icon="remove" aria-label="삭제" onClick={() => onChange(removeArrayItem(relations, index))} />
          </div>
        ))}
        <IconButton
          icon="add"
          aria-label="추가"
          className="self-start"
          onClick={() => onChange([...relations, { target: "", type: "" }])}
        />
      </fieldset>
    </div>
  )
}
