import type React from "react"

import { removeArrayItem, replaceArrayItem } from "@webview/lib/fieldUtils"
import { sbControlButtonClass, sbInputClass } from "@webview/components/ui/formClasses"

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
          <button type="button" className={sbControlButtonClass} onClick={() => onChange(removeArrayItem(values, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange([...values, ""])}>
        추가
      </button>
    </fieldset>
  )
}
