import type React from "react"

import type { CardAttributeValue } from "@webview/lib/types"
import { removeRecordKey, renameRecordKey } from "@webview/lib/fieldUtils"
import { IconButton } from "@webview/components/ui/IconButton"
import { sbInputClass } from "@webview/components/ui/formClasses"

export function KeyValueField({
  label,
  values,
  onChange
}: {
  readonly label: string
  readonly values: Record<string, CardAttributeValue>
  readonly onChange: (values: Record<string, CardAttributeValue>) => void
}): React.ReactElement {
  const entries = Object.entries(values)

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
      <legend className="px-1 text-sm text-sb-fg-muted">{label}</legend>
      {entries.map(([key, value], index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5" key={`${label}-${index}`}>
          <input
            className={sbInputClass}
            aria-label="key"
            value={key}
            onChange={(event) => onChange(renameRecordKey(values, key, event.target.value))}
          />
          <input
            className={sbInputClass}
            aria-label="value"
            value={String(value ?? "")}
            onChange={(event) => onChange({ ...values, [key]: event.target.value })}
          />
          <IconButton icon="remove" aria-label="삭제" onClick={() => onChange(removeRecordKey(values, key))} />
        </div>
      ))}
      <IconButton icon="add" aria-label="추가" className="self-start" onClick={() => onChange({ ...values, newKey: "" })} />
    </fieldset>
  )
}
