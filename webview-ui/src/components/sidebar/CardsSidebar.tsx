import React, { useEffect, useMemo, useState } from "react"

import { createRequestId, parseSidebarCardsInitialData } from "../../lib/messaging"
import type { SidebarCardSummary, SidebarCardsInitialData, StoryboardEventMessage } from "../../lib/types"

export function CardsSidebar({ initialData }: { readonly initialData: SidebarCardsInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [sidebarState, setSidebarState] = useState(initialData)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "cards.listChanged") {
        return
      }

      setSidebarState(parseSidebarCardsInitialData(event.data.payload))
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const openCard = (card: SidebarCardSummary): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method: "cards.open",
      payload: { uri: card.uri }
    })
  }

  if (!sidebarState.isStoryboardProject) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
        <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        <p className="m-0 leading-normal text-sb-fg-muted">
          Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.
        </p>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
      <h1 className="m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>

      {sidebarState.cards.length === 0 ? (
        <p className="m-0 leading-normal text-sb-fg-muted">
          아직 {sidebarState.type === "character" ? "캐릭터" : "배경"} 카드가 없습니다.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[0.35rem] p-0" aria-label={`${sidebarState.title} card list`}>
          {sidebarState.cards.map((card) => (
            <li key={card.uri}>
              <button
                className="flex w-full cursor-pointer flex-col gap-[0.2rem] rounded-md border border-transparent bg-transparent p-2 text-left text-sb-fg hover:border-sb-border-focus hover:bg-sb-bg-list-hover focus:border-sb-border-focus focus:bg-sb-bg-list-hover focus:outline-none"
                type="button"
                onClick={() => openCard(card)}
              >
                <span className="font-semibold">{card.name}</span>
                <span className="truncate text-sm text-sb-fg-muted">{card.id}</span>
                {card.error ? <span className="text-sm text-sb-fg-error">{card.error}</span> : null}
                {!card.error && card.description ? (
                  <span className="truncate text-sm text-sb-fg-muted">{card.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
