import React from "react"

import { actionIcon, actionLabel, type StudioSlashCommand } from "@webview/lib/studioCommands"

export function SlashCommandMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  readonly items: readonly StudioSlashCommand[]
  readonly activeIndex: number
  readonly onSelect: (command: string) => void
  readonly onHover: (index: number) => void
}): React.ReactElement | null {
  if (items.length === 0) {
    return null
  }

  return (
    <ul
      id="studio-slash-menu"
      role="listbox"
      aria-label="슬래시 명령"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-52 list-none overflow-y-auto rounded-lg border border-sb-border bg-sb-bg-widget p-1"
    >
      {items.map((item, index) => {
        const ActionIcon = actionIcon(item.action)
        const isActive = index === activeIndex

        return (
          <li key={item.command}>
            <button
              type="button"
              role="option"
              id={`studio-slash-option-${index}`}
              aria-selected={isActive}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-sb-fg outline-none ${
                isActive ? "bg-sb-bg-list-hover" : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(item.command)
              }}
              onMouseEnter={() => onHover(index)}
            >
              <ActionIcon className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />
              <span className="font-medium">/{item.command}</span>
              <span className="text-xs text-sb-fg-muted">{actionLabel(item.action)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
