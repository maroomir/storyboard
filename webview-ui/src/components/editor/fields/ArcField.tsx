import type React from "react"

import { ArcCurveView } from "@webview/components/character/ArcCurveView"
import type { CharacterArc } from "@webview/lib/types"
import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { IconButton } from "@webview/components/ui/IconButton"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function ArcField({
  arc,
  onChange
}: {
  readonly arc: readonly CharacterArc[]
  readonly onChange: (arc: CharacterArc[]) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ArcCurveView arc={arc} />
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
        <legend className="px-1 text-sm text-sb-fg-muted">Arc</legend>
        {arc.map((item, index) => (
          <div className="flex flex-col gap-1.5 border-b border-sb-border pb-2" key={`arc-${index}`}>
            <input
              className={sbInputClass}
              placeholder="stage"
              value={item.stage}
              onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, stage: event.target.value }))}
            />
            <input
              className={sbInputClass}
              placeholder="summary"
              value={item.summary}
              onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, summary: event.target.value }))}
            />
            <input
              className={sbInputClass}
              placeholder="sceneRef"
              value={item.sceneRef ?? ""}
              onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, sceneRef: event.target.value }))}
            />
            <IconButton
              icon="remove"
              aria-label="삭제"
              className="self-start"
              onClick={() => onChange(removeArrayItem(arc, index))}
            />
          </div>
        ))}
        <IconButton
          icon="add"
          aria-label="추가"
          className="self-start"
          onClick={() => onChange([...arc, { stage: "", summary: "", sceneRef: "" }])}
        />
      </fieldset>
    </div>
  )
}
