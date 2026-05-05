import { Pencil, Sparkles } from "lucide-react"
import React, { useEffect, useMemo, useState } from "react"

import { StoryboardCard } from "../card/StoryboardCard"
import { Button } from "../ui/Button"
import { EmptyState } from "../ui/EmptyState"
import { createRequestId, parseSidebarCardsInitialData } from "../../lib/messaging"
import type { SidebarCardSummary, SidebarCardsInitialData, StoryboardCard as StoryboardCardModel, StoryboardEventMessage } from "../../lib/types"

function summaryToCardModel(summary: SidebarCardSummary): StoryboardCardModel {
  return {
    type: summary.type,
    id: summary.id,
    name: summary.name,
    description: summary.description
  }
}

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
        <ul
          className="m-0 grid list-none grid-cols-1 gap-3 p-0 @[320px]:grid-cols-2"
          aria-label={`${sidebarState.title} card list`}
        >
          {sidebarState.cards.map((card) => (
            <li key={card.uri} className="group/card relative min-w-0">
              <div
                className="relative cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sb-border-focus"
                role="button"
                tabIndex={0}
                onClick={() => openCard(card)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openCard(card)
                  }
                }}
              >
                <StoryboardCard
                  card={summaryToCardModel(card)}
                  variant="compact"
                  className="max-w-none"
                />
                <div className="pointer-events-none absolute right-1 top-9 z-[5] opacity-0 transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100">
                  <Button
                    variant="secondary"
                    type="button"
                    className="pointer-events-auto flex h-8 w-8 items-center justify-center p-0 shadow-md"
                    aria-label={`${card.name} 편집`}
                    onClick={(event) => {
                      event.stopPropagation()
                      openCard(card)
                    }}
                  >
                    <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                  </Button>
                </div>
              </div>
              {card.error ? (
                <p className="mt-1.5 text-xs leading-normal text-sb-fg-error">{card.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
