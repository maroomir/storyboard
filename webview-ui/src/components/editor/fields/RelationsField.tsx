import type React from "react"

import type { CharacterRelation } from "@webview/lib/types"
import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { sbControlButtonClass, sbInputClass } from "@webview/components/ui/formClasses"

export function RelationsField({
  relations,
  onChange
}: {
  readonly relations: readonly CharacterRelation[]
  readonly onChange: (relations: CharacterRelation[]) => void
}): React.ReactElement {
  return (
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
          <button type="button" className={sbControlButtonClass} onClick={() => onChange(removeArrayItem(relations, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange([...relations, { target: "", type: "" }])}>
        추가
      </button>
    </fieldset>
  )
}
