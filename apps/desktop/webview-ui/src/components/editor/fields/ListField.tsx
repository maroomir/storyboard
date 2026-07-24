import type React from "react"

import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { IconButton } from "@webview/components/ui/IconButton"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function ListField({
  label,
  values,
  onChange
}: {
  readonly label: string
  readonly values: readonly string[]
  readonly onChange: (values: string[]) => void
}): React.ReactElement {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
      <legend className="px-1 text-sm text-sb-fg-muted">{label}</legend>
      {values.map((value, index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5" key={`${label}-${index}`}>
          <input
            className={sbInputClass}
            value={value}
            onChange={(event) => onChange(replaceArrayItem(values, index, event.target.value))}
          />
          <IconButton icon="remove" aria-label="삭제" onClick={() => onChange(removeArrayItem(values, index))} />
        </div>
      ))}
      <IconButton icon="add" aria-label="추가" className="self-start" onClick={() => onChange([...values, ""])} />
    </fieldset>
  )
}
