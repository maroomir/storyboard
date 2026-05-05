import { Pencil, Sparkles, Trash2 } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import { Button } from "../ui/Button"
import { EmptyState } from "../ui/EmptyState"
import { createRequestId, parseSidebarCardsInitialData } from "../../lib/messaging"
import type { SidebarCardSummary, SidebarCardsInitialData, StoryboardEventMessage, StoryboardRequestMethod } from "../../lib/types"

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

  const postCardRequest = (method: StoryboardRequestMethod, payload: Record<string, unknown>): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method,
      payload
    })
  }

  const openCard = (card: SidebarCardSummary): void => postCardRequest("cards.open", { uri: card.uri })
  const deleteCard = (card: SidebarCardSummary): void => postCardRequest("cards.delete", { uri: card.uri })

  const kindLabel = sidebarState.type === "character" ? "캐릭터" : "배경"

  if (!sidebarState.isStoryboardProject) {
    return (
      <main className="@container flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
        <h1 className="font-display m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>
        <EmptyState
          icon={Sparkles}
          title="Storyboard 프로젝트가 필요합니다"
          description="워크스페이스에 Storyboard를 초기화한 뒤 캐릭터와 배경 카드를 이 목록에서 볼 수 있습니다. 명령 팔레트에서 Storyboard: Initialize Project를 실행하세요."
        />
      </main>
    )
  }

  return (
    <main className="@container flex min-h-screen flex-col gap-3 bg-sb-bg-sidebar p-3">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
      <h1 className="font-display m-0 text-xl leading-snug text-sb-fg">{sidebarState.title}</h1>

      {sidebarState.cards.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={`${kindLabel} 카드가 없습니다`}
          description={`아직 등록된 ${kindLabel} 카드가 없습니다. 뷰 제목 표시줄의 + 버튼으로 새 카드를 만들 수 있습니다.`}
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`${sidebarState.title} card list`}>
          {sidebarState.cards.map((card) => (
            <li
              key={card.uri}
              className="group/card overflow-hidden rounded-lg border border-sb-border bg-sb-bg-widget shadow-cardRest transition hover:border-sb-border-focus hover:shadow-cardHover"
            >
              <div className="flex min-w-0 items-start gap-2 p-2.5">
                <button
                  className="min-w-0 flex-1 cursor-pointer rounded-md border border-transparent bg-transparent p-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-sb-border-focus"
                  type="button"
                  onClick={() => openCard(card)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold leading-snug text-sb-fg">{card.name}</span>
                    <span className="shrink-0 rounded-full border border-sb-border bg-sb-bg-sidebar px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-sb-fg-muted">
                      {card.type === "character" ? "캐릭터" : "배경"}
                    </span>
                  </span>
                  {card.error ? (
                    <span className="mt-1 block line-clamp-2 text-xs leading-normal text-sb-fg-error">{card.error}</span>
                  ) : card.description ? (
                    <span className="mt-1 block line-clamp-2 text-xs leading-normal text-sb-fg-muted">{card.description}</span>
                  ) : null}
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex h-7 w-7 items-center justify-center p-0 text-sb-fg-muted hover:text-sb-fg"
                    aria-label={`${card.name} 편집`}
                    onClick={(event) => {
                      event.stopPropagation()
                      openCard(card)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex h-7 w-7 items-center justify-center p-0 text-sb-fg-muted hover:text-sb-fg-error"
                    aria-label={`${card.name} 삭제`}
                    onClick={(event) => {
                      event.stopPropagation()
                      deleteCard(card)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
