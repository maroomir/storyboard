import { History, MessageSquare } from "lucide-react"
import React from "react"

import type { StudioSessionSummary } from "@webview/lib/types"
import { EmptyState } from "../ui/EmptyState"
import { Pill } from "../ui/Pill"

export function StudioSessionList({
  sessions,
  onOpen
}: {
  readonly sessions: readonly StudioSessionSummary[]
  readonly onOpen: (id: string) => void
}): React.ReactElement {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="대화 기록"
        description="저장된 대화가 아직 없습니다. 작업을 실행하면 이곳에 기록됩니다."
      />
    )
  }

  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="저장된 대화">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            className="flex w-full flex-col gap-1 rounded-lg border border-sb-border bg-sb-bg-widget px-3 py-2 text-left outline-none hover:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
            onClick={() => onOpen(session.id)}
          >
            <span className="truncate text-sm text-sb-fg">{session.title}</span>
            <span className="flex items-center gap-2 text-xs text-sb-fg-muted">
              {formatSessionTimestamp(session.updatedAt)}
              <Pill icon={MessageSquare}>{session.turnCount}</Pill>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function formatSessionTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  const pad = (part: number): string => String(part).padStart(2, "0")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}
