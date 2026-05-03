import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"

type CardType = "character" | "background"
type StoryboardRequestMethod = "cards.write" | "cards.open"
type CardAttributeValue = string | number | boolean | null

interface CharacterRelation {
  readonly target: string
  readonly type: string
}

interface CharacterArc {
  readonly stage: string
  readonly summary: string
  readonly sceneRef?: string
}

interface StoryboardCard {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly profile?: string
  readonly concept?: string
  readonly role?: string
  readonly country?: string
  readonly category?: string
  readonly attributes?: Record<string, CardAttributeValue>
  readonly tags?: readonly string[]
  readonly traits?: readonly string[]
  readonly relations?: readonly CharacterRelation[]
  readonly arc?: readonly CharacterArc[]
  readonly recentDialogues?: readonly string[]
}

interface CardEditorInitialData {
  readonly documentUri: string
  readonly rawText: string
  readonly card?: StoryboardCard
  readonly imageUri?: string
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
        {documentState.imageUri ? (
          <img className="card-image-preview" src={documentState.imageUri} alt={`${card.name} preview`} />
        ) : (
          <div className="image-placeholder">
            <span>{card.type === "character" ? "Character" : "Background"}</span>
            <strong>{card.name}</strong>
          </div>
        )}
        <p className="description">카드의 {card.type === "character" ? "profile" : "concept"} 경로를 기준으로 표시합니다.</p>
      </section>

      <section className="editor-panel form-panel" aria-label="카드 편집 폼">
        <p className="eyebrow">{card.type} card</p>
        <h1>{card.name}</h1>

        {pendingExternalData ? (
          <div className="reload-banner">
            <span>외부에서 YAML이 변경되었습니다.</span>
            <button type="button" onClick={() => applyDocumentState(pendingExternalData)}>
              다시 불러오기
            </button>
          </div>
        ) : null}

        <label className="field">
          <span>ID</span>
          <input value={card.id} readOnly />
        </label>

        <label className="field">
          <span>Name</span>
          <input value={card.name} onChange={(event) => updateCard({ ...card, name: event.target.value })} />
        </label>

        {card.type === "character" ? <CharacterFields card={card} updateCard={updateCard} /> : null}
        {card.type === "background" ? <BackgroundFields card={card} updateCard={updateCard} /> : null}

        <label className="field">
          <span>Description</span>
          <textarea
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

        <details className="raw-yaml-details">
          <summary>Raw YAML</summary>
          <textarea className="raw-yaml" readOnly value={documentState.rawText} />
        </details>

        <p className="status-message">{status}</p>
      </section>
    </main>
  )
}

function CharacterFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <label className="field">
        <span>Role</span>
        <input value={card.role ?? ""} onChange={(event) => updateCard({ ...card, role: event.target.value })} />
      </label>
      <label className="field">
        <span>Profile</span>
        <input value={card.profile ?? ""} onChange={(event) => updateCard({ ...card, profile: event.target.value })} />
      </label>
    </>
  )
}

function BackgroundFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <label className="field">
        <span>Concept</span>
        <input value={card.concept ?? ""} onChange={(event) => updateCard({ ...card, concept: event.target.value })} />
      </label>
      <label className="field">
        <span>Country</span>
        <input value={card.country ?? ""} onChange={(event) => updateCard({ ...card, country: event.target.value })} />
      </label>
      <label className="field">
        <span>Category</span>
        <input value={card.category ?? ""} onChange={(event) => updateCard({ ...card, category: event.target.value })} />
      </label>
    </>
  )
}

function ListField({
  label,
  values,
  onChange
}: {
  readonly label: string
  readonly values: readonly string[]
  readonly onChange: (values: string[]) => void
}): React.ReactElement {
  return (
    <fieldset className="dynamic-field">
      <legend>{label}</legend>
      {values.map((value, index) => (
        <div className="dynamic-row" key={`${label}-${index}`}>
          <input
            value={value}
            onChange={(event) => onChange(replaceArrayItem(values, index, event.target.value))}
          />
          <button type="button" onClick={() => onChange(removeArrayItem(values, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...values, ""])}>
        추가
      </button>
    </fieldset>
  )
}

function KeyValueField({
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
    <fieldset className="dynamic-field">
      <legend>{label}</legend>
      {entries.map(([key, value], index) => (
        <div className="dynamic-row" key={`${label}-${index}`}>
          <input
            aria-label="key"
            value={key}
            onChange={(event) => onChange(renameRecordKey(values, key, event.target.value))}
          />
          <input
            aria-label="value"
            value={String(value ?? "")}
            onChange={(event) => onChange({ ...values, [key]: event.target.value })}
          />
          <button type="button" onClick={() => onChange(removeRecordKey(values, key))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...values, newKey: "" })}>
        추가
      </button>
    </fieldset>
  )
}

function RelationsField({
  relations,
  onChange
}: {
  readonly relations: readonly CharacterRelation[]
  readonly onChange: (relations: CharacterRelation[]) => void
}): React.ReactElement {
  return (
    <fieldset className="dynamic-field">
      <legend>Relations</legend>
      {relations.map((relation, index) => (
        <div className="dynamic-row" key={`relation-${index}`}>
          <input
            placeholder="target"
            value={relation.target}
            onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, target: event.target.value }))}
          />
          <input
            placeholder="type"
            value={relation.type}
            onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, type: event.target.value }))}
          />
          <button type="button" onClick={() => onChange(removeArrayItem(relations, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...relations, { target: "", type: "" }])}>
        추가
      </button>
    </fieldset>
  )
}

function ArcField({
  arc,
  onChange
}: {
  readonly arc: readonly CharacterArc[]
  readonly onChange: (arc: CharacterArc[]) => void
}): React.ReactElement {
  return (
    <fieldset className="dynamic-field">
      <legend>Arc</legend>
      {arc.map((item, index) => (
        <div className="dynamic-column" key={`arc-${index}`}>
          <input
            placeholder="stage"
            value={item.stage}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, stage: event.target.value }))}
          />
          <input
            placeholder="summary"
            value={item.summary}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, summary: event.target.value }))}
          />
          <input
            placeholder="sceneRef"
            value={item.sceneRef ?? ""}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, sceneRef: event.target.value }))}
          />
          <button type="button" onClick={() => onChange(removeArrayItem(arc, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...arc, { stage: "", summary: "", sceneRef: "" }])}>
        추가
      </button>
    </fieldset>
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

function replaceArrayItem<T>(items: readonly T[], index: number, nextItem: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item))
}

function removeArrayItem<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index)
}

function renameRecordKey(
  record: Record<string, CardAttributeValue>,
  previousKey: string,
  nextKey: string
): Record<string, CardAttributeValue> {
  const nextRecord: Record<string, CardAttributeValue> = {}

  for (const [key, value] of Object.entries(record)) {
    nextRecord[key === previousKey ? nextKey : key] = value
  }

  return nextRecord
}

function removeRecordKey(
  record: Record<string, CardAttributeValue>,
  targetKey: string
): Record<string, CardAttributeValue> {
  const nextRecord = { ...record }
  delete nextRecord[targetKey]
  return nextRecord
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
