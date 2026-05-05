import React, { useEffect, useMemo, useState } from "react"

import { createRequestId, parseCardEditorInitialData } from "../../lib/messaging"
import type { CardEditorInitialData, StoryboardCard, StoryboardEventMessage } from "../../lib/types"
import { sbControlButtonClass, sbInputClass, sbYamlTextareaClass } from "../ui/formClasses"
import { ArcField } from "./fields/ArcField"
import { BackgroundFields } from "./fields/BackgroundFields"
import { CharacterFields } from "./fields/CharacterFields"
import { KeyValueField } from "./fields/KeyValueField"
import { ListField } from "./fields/ListField"
import { RelationsField } from "./fields/RelationsField"

export function CardEditor({ initialData }: { readonly initialData: CardEditorInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [documentState, setDocumentState] = useState(initialData)
  const [card, setCard] = useState<StoryboardCard | undefined>(initialData.card)
  const [status, setStatus] = useState("문서에서 카드 정보를 불러왔습니다.")
  const [isDirty, setIsDirty] = useState(false)
  const [pendingExternalData, setPendingExternalData] = useState<CardEditorInitialData | undefined>()

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "cards.changed") {
        return
      }

      const nextDocumentState = parseCardEditorInitialData(event.data.payload)

      if (isDirty) {
        setPendingExternalData(nextDocumentState)
        setStatus("외부에서 카드가 변경되었습니다. 필요하면 다시 불러오세요.")
        return
      }

      applyDocumentState(nextDocumentState)
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [isDirty])

  const applyDocumentState = (nextDocumentState: CardEditorInitialData): void => {
    setDocumentState(nextDocumentState)
    setCard(nextDocumentState.card)
    setIsDirty(false)
    setPendingExternalData(undefined)
    setStatus("문서 변경 사항을 다시 불러왔습니다.")
  }

  const updateCard = (nextCard: StoryboardCard): void => {
    setCard(nextCard)
    setIsDirty(true)
    setStatus("변경 사항을 문서에 반영하는 중입니다…")

    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method: "cards.write",
      payload: {
        uri: documentState.documentUri,
        card: nextCard
      }
    })
  }

  if (documentState.error || !card) {
    return (
      <main className="grid min-h-screen grid-cols-1 gap-4 bg-sb-bg p-4">
        <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar p-4">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard Card</p>
          <h1 className="m-0 text-xl leading-snug text-sb-fg">YAML을 카드로 읽을 수 없습니다</h1>
          <p className="m-0 text-sb-fg-error">{documentState.error ?? "알 수 없는 오류"}</p>
          <textarea className={sbYamlTextareaClass} readOnly value={documentState.rawText} />
        </section>
      </main>
    )
  }

  const panelClass = "flex min-w-0 flex-col gap-4 rounded-lg border border-sb-border bg-sb-bg-sidebar p-4"

  return (
    <main className="grid min-h-screen grid-cols-[minmax(220px,0.85fr)_minmax(320px,1.15fr)] gap-4 bg-sb-bg p-4 max-[760px]:grid-cols-1">
      <section className={panelClass} aria-label="카드 미리보기">
        {documentState.imageUri ? (
          <img
            className="block max-h-[420px] w-full rounded-lg border border-sb-border object-contain"
            src={documentState.imageUri}
            alt={`${card.name} preview`}
          />
        ) : (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-sb-fg-muted text-center text-sb-fg-muted">
            <span>{card.type === "character" ? "Character" : "Background"}</span>
            <strong className="text-lg text-sb-fg">{card.name}</strong>
          </div>
        )}
        <p className="m-0 leading-normal text-sb-fg-muted">
          카드의 {card.type === "character" ? "profile" : "concept"} 경로를 기준으로 표시합니다.
        </p>
      </section>

      <section className={panelClass} aria-label="카드 편집 폼">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">{card.type} card</p>
        <h1 className="m-0 text-xl leading-snug text-sb-fg">{card.name}</h1>

        {pendingExternalData ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-sb-border-warning bg-sb-bg-widget px-2.5 py-2.5 text-sb-fg">
            <span>외부에서 YAML이 변경되었습니다.</span>
            <button type="button" className={sbControlButtonClass} onClick={() => applyDocumentState(pendingExternalData)}>
              다시 불러오기
            </button>
          </div>
        ) : null}

        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">ID</span>
          <input className={sbInputClass} value={card.id} readOnly />
        </label>

        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Name</span>
          <input
            className={sbInputClass}
            value={card.name}
            onChange={(event) => updateCard({ ...card, name: event.target.value })}
          />
        </label>

        {card.type === "character" ? <CharacterFields card={card} updateCard={updateCard} /> : null}
        {card.type === "background" ? <BackgroundFields card={card} updateCard={updateCard} /> : null}

        <label className="flex flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Description</span>
          <textarea
            className={`${sbInputClass} min-h-32 resize-y`}
            value={card.description ?? ""}
            onChange={(event) => updateCard({ ...card, description: event.target.value })}
          />
        </label>

        <ListField label="Tags" values={card.tags ?? []} onChange={(tags) => updateCard({ ...card, tags })} />

        {card.type === "character" ? (
          <>
            <ListField label="Traits" values={card.traits ?? []} onChange={(traits) => updateCard({ ...card, traits })} />
            <ListField
              label="Recent Dialogues"
              values={card.recentDialogues ?? []}
              onChange={(recentDialogues) => updateCard({ ...card, recentDialogues })}
            />
            <KeyValueField
              label="Attributes"
              values={card.attributes ?? {}}
              onChange={(attributes) => updateCard({ ...card, attributes })}
            />
            <RelationsField
              relations={card.relations ?? []}
              onChange={(relations) => updateCard({ ...card, relations })}
            />
            <ArcField arc={card.arc ?? []} onChange={(arc) => updateCard({ ...card, arc })} />
          </>
        ) : null}

        <details className="border-t border-sb-border pt-4">
          <summary className="cursor-pointer text-sb-fg-link">Raw YAML</summary>
          <textarea className={sbYamlTextareaClass} readOnly value={documentState.rawText} />
        </details>

        <p className="m-0 text-sb-fg-muted">{status}</p>
      </section>
    </main>
  )
}
