import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

type CardType = "character" | "background"
type StoryboardRequestMethod = "cards.write" | "cards.open"

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

interface SidebarCardSummary {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly uri: string
  readonly description?: string
  readonly error?: string
}

interface SidebarCardsInitialData {
  readonly type: CardType
  readonly title: string
  readonly cards: readonly SidebarCardSummary[]
  readonly isStoryboardProject: boolean
}

interface StoryboardRequestMessage {
  readonly protocolVersion: "1.0.0"
  readonly type: "request"
  readonly id: string
  readonly method: StoryboardRequestMethod
  readonly payload: Record<string, unknown>
}

interface StoryboardEventMessage {
  readonly type: "event"
  readonly method: "cards.changed" | "cards.listChanged"
  readonly payload: unknown
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
    return <CardEditor initialData={parseCardEditorInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "cards-sidebar") {
    return <CardsSidebar initialData={parseSidebarCardsInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
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

function CardsSidebar({ initialData }: { readonly initialData: SidebarCardsInitialData }): React.ReactElement {
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
      <main className="cards-sidebar">
        <p className="eyebrow">Storyboard</p>
        <h1>{sidebarState.title}</h1>
        <p className="description">Storyboard 프로젝트가 아닙니다. 먼저 Initialize Project를 실행해 주세요.</p>
      </main>
    )
  }

  return (
    <main className="cards-sidebar">
      <p className="eyebrow">Storyboard</p>
      <h1>{sidebarState.title}</h1>

      {sidebarState.cards.length === 0 ? (
        <p className="description">아직 {sidebarState.type === "character" ? "캐릭터" : "배경"} 카드가 없습니다.</p>
      ) : (
        <ul className="card-list" aria-label={`${sidebarState.title} card list`}>
          {sidebarState.cards.map((card) => (
            <li key={card.uri}>
              <button className="card-list-item" type="button" onClick={() => openCard(card)}>
                <span className="card-list-item__title">{card.name}</span>
                <span className="card-list-item__meta">{card.id}</span>
                {card.error ? <span className="card-list-item__error">{card.error}</span> : null}
                {!card.error && card.description ? (
                  <span className="card-list-item__description">{card.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
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

      const nextDocumentState = parseCardEditorInitialData(event.data.payload)
      setDocumentState(nextDocumentState)
      setCard(nextDocumentState.card)
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

function parseCardEditorInitialData(value: unknown): CardEditorInitialData {
  if (isCardEditorInitialData(value)) {
    return value
  }

  return {
    documentUri: "",
    rawText: "",
    error: "초기 카드 데이터를 읽을 수 없습니다."
  }
}

function parseSidebarCardsInitialData(value: unknown): SidebarCardsInitialData {
  if (isSidebarCardsInitialData(value)) {
    return value
  }

  return {
    type: "character",
    title: "Cards",
    cards: [],
    isStoryboardProject: false
  }
}

function isCardEditorInitialData(value: unknown): value is CardEditorInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<CardEditorInitialData>
  return typeof candidate.documentUri === "string" && typeof candidate.rawText === "string"
}

function isSidebarCardsInitialData(value: unknown): value is SidebarCardsInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<SidebarCardsInitialData>
  return (
    isCardType(candidate.type) &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.cards) &&
    typeof candidate.isStoryboardProject === "boolean"
  )
}

function isCardType(value: unknown): value is CardType {
  return value === "character" || value === "background"
}

function createRequestId(): string {
  return crypto.randomUUID()
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
