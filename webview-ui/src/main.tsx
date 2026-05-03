import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

type CardType = "character" | "background"

interface StoryboardCard {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly [key: string]: unknown
}

interface CardEditorInitialData {
  readonly documentUri: string
  readonly rawText: string
  readonly card?: StoryboardCard
  readonly error?: string
}

interface StoryboardRequestMessage {
  readonly protocolVersion: "1.0.0"
  readonly type: "request"
  readonly id: string
  readonly method: "cards.write"
  readonly payload: {
    readonly uri: string
    readonly card: StoryboardCard
  }
}

interface StoryboardEventMessage {
  readonly type: "event"
  readonly method: "cards.changed"
  readonly payload: CardEditorInitialData
}

declare global {
  interface Window {
    readonly __STORYBOARD_VIEW__?: string
    readonly __STORYBOARD_INITIAL_DATA__?: unknown
    readonly acquireVsCodeApi?: () => {
      readonly postMessage: (message: StoryboardRequestMessage) => void
    }
  }
}

function App(): React.ReactElement {
  if (window.__STORYBOARD_VIEW__ === "card-editor") {
    return <CardEditor initialData={parseInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  return <SidebarPlaceholder />
}

function SidebarPlaceholder(): React.ReactElement {
  return (
    <main className="placeholder">
      <p className="eyebrow">Storyboard</p>
      <h1>Coming soon: Phase 2</h1>
      <p className="description">
        캐릭터, 배경, 씬을 탐색하는 사이드바가 이 위치에 표시될 예정입니다.
      </p>
    </main>
  )
}

function CardEditor({ initialData }: { readonly initialData: CardEditorInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [documentState, setDocumentState] = useState(initialData)
  const [card, setCard] = useState<StoryboardCard | undefined>(initialData.card)
  const [status, setStatus] = useState("문서에서 카드 정보를 불러왔습니다.")

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "cards.changed") {
        return
      }

      setDocumentState(event.data.payload)
      setCard(event.data.payload.card)
      setStatus("문서 변경 사항을 다시 불러왔습니다.")
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const updateCard = (nextCard: StoryboardCard): void => {
    setCard(nextCard)
    setStatus("변경 사항을 문서에 반영하는 중입니다…")

    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: crypto.randomUUID(),
      method: "cards.write",
      payload: {
        uri: documentState.documentUri,
        card: nextCard
      }
    })
  }

  if (documentState.error || !card) {
    return (
      <main className="card-editor">
        <section className="editor-panel editor-panel--full">
          <p className="eyebrow">Storyboard Card</p>
          <h1>YAML을 카드로 읽을 수 없습니다</h1>
          <p className="error-message">{documentState.error ?? "알 수 없는 오류"}</p>
          <textarea className="raw-yaml" readOnly value={documentState.rawText} />
        </section>
      </main>
    )
  }

  return (
    <main className="card-editor">
      <section className="editor-panel image-panel" aria-label="카드 미리보기">
        <div className="image-placeholder">
          <span>{card.type === "character" ? "Character" : "Background"}</span>
          <strong>{card.name}</strong>
        </div>
        <p className="description">이미지 미리보기는 PR 2.5에서 실제 파일 URI 연결과 함께 확장합니다.</p>
      </section>

      <section className="editor-panel form-panel" aria-label="카드 편집 폼">
        <p className="eyebrow">{card.type} card</p>
        <h1>{card.name}</h1>

        <label className="field">
          <span>ID</span>
          <input value={card.id} readOnly />
        </label>

        <label className="field">
          <span>Name</span>
          <input value={card.name} onChange={(event) => updateCard({ ...card, name: event.target.value })} />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            value={card.description ?? ""}
            onChange={(event) => updateCard({ ...card, description: event.target.value })}
          />
        </label>

        <details className="raw-yaml-details">
          <summary>Raw YAML</summary>
          <textarea className="raw-yaml" readOnly value={documentState.rawText} />
        </details>

        <p className="status-message">{status}</p>
      </section>
    </main>
  )
}

function parseInitialData(value: unknown): CardEditorInitialData {
  if (isCardEditorInitialData(value)) {
    return value
  }

  return {
    documentUri: "",
    rawText: "",
    error: "초기 카드 데이터를 읽을 수 없습니다."
  }
}

function isCardEditorInitialData(value: unknown): value is CardEditorInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<CardEditorInitialData>
  return typeof candidate.documentUri === "string" && typeof candidate.rawText === "string"
}

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
