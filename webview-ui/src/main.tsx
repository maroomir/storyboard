import React, { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import { parseRelationGraphInitialData, RelationGraph } from "./RelationGraph"
import "./styles.css"

const sbInputClass =
  "w-full border border-[color:var(--vscode-input-border)] bg-sb-bg-input p-2 text-sb-fg-input"

const sbControlButtonClass =
  "cursor-pointer rounded border border-[color:var(--vscode-button-border)] bg-sb-bg-button px-2 py-1.5 text-sm text-sb-fg-button hover:bg-sb-bg-button-hover"

const sbYamlTextareaClass = `${sbInputClass} mt-3 min-h-72 resize-y font-[family-name:var(--vscode-editor-font-family)] text-[length:var(--vscode-editor-font-size)]`

type CardType = "character" | "background"
type StoryboardRequestMethod =
  | "cards.write"
  | "cards.open"
  | "scenes.openScene"
  | "scenes.openDraft"
  | "scenes.generateDraft"
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

interface SceneListItem {
  readonly stem: string
  readonly order: number
  readonly slug: string
  readonly title?: string
  readonly sceneUri: string
  readonly draftUri?: string
  readonly status: "ready" | "stale" | "missing"
  readonly sceneMtime: number
  readonly draftMtime?: number
}

interface SidebarScenesInitialData {
  readonly title: string
  readonly scenes: readonly SceneListItem[]
  readonly isStoryboardProject: boolean
}

interface StoryboardEventMessage {
  readonly type: "event"
  readonly method: "cards.changed" | "cards.listChanged" | "scenes.listChanged" | "relations.listChanged"
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

  if (window.__STORYBOARD_VIEW__ === "scenes-sidebar") {
    return <ScenesSidebar initialData={parseSidebarScenesInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  if (window.__STORYBOARD_VIEW__ === "relation-graph") {
    return <RelationGraph initialData={parseRelationGraphInitialData(window.__STORYBOARD_INITIAL_DATA__)} />
  }

  return <SidebarPlaceholder />
}

function SidebarPlaceholder(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-3 p-5">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">Storyboard</p>
      <h1 className="m-0 text-xl leading-snug text-sb-fg">Coming soon: Phase 2</h1>
      <p className="m-0 leading-normal text-sb-fg-muted">
        캐릭터, 배경, 씬을 탐색하는 사이드바가 이 위치에 표시될 예정입니다.
      </p>
    </main>
  )
}

function statusBadgeEmoji(status: SceneListItem["status"]): string {
  switch (status) {
    case "ready":
      return "✅"
    case "stale":
      return "⚠️"
    case "missing":
      return "⬜"
    default:
      return ""
  }
}

function ScenesSidebar({ initialData }: { readonly initialData: SidebarScenesInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [sidebarState, setSidebarState] = useState(initialData)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<StoryboardEventMessage>): void => {
      if (event.data.type !== "event" || event.data.method !== "scenes.listChanged") {
        return
      }

      setSidebarState(parseSidebarScenesInitialData(event.data.payload))
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const postSceneRequest = (method: StoryboardRequestMethod, payload: Record<string, unknown>): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method,
      payload
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

      {sidebarState.scenes.length === 0 ? (
        <p className="m-0 leading-normal text-sb-fg-muted">아직 씬 파일이 없습니다. 상단 + 버튼으로 새 씬을 추가해 보세요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Scene list">
          {sidebarState.scenes.map((scene) => (
            <li
              key={scene.sceneUri}
              className="flex flex-col gap-2 rounded-md border border-transparent bg-transparent p-2 hover:border-sb-border-focus hover:bg-sb-bg-list-hover"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-base" title={scene.status}>
                  {statusBadgeEmoji(scene.status)}
                </span>
                <button
                  className="min-w-0 flex-1 cursor-pointer rounded border border-transparent bg-transparent p-0 text-left text-sb-fg hover:underline focus:border-sb-border-focus focus:outline-none"
                  type="button"
                  onClick={() => postSceneRequest("scenes.openScene", { uri: scene.sceneUri })}
                >
                  <span className="block font-semibold">{scene.title ?? scene.slug}</span>
                  <span className="block truncate text-sm text-sb-fg-muted">{scene.stem}.txt</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-7">
                <button
                  type="button"
                  className={sbControlButtonClass}
                  onClick={() => postSceneRequest("scenes.generateDraft", { uri: scene.sceneUri })}
                >
                  Generate
                </button>
                <button
                  type="button"
                  className={`${sbControlButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
                  disabled={!scene.draftUri}
                  onClick={() => {
                    if (scene.draftUri) {
                      postSceneRequest("scenes.openDraft", { uri: scene.draftUri })
                    }
                  }}
                >
                  Open Draft
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
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

function CharacterFields({
  card,
  updateCard
}: {
  readonly card: StoryboardCard
  readonly updateCard: (card: StoryboardCard) => void
}): React.ReactElement {
  return (
    <>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Role</span>
        <input
          className={sbInputClass}
          value={card.role ?? ""}
          onChange={(event) => updateCard({ ...card, role: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Profile</span>
        <input
          className={sbInputClass}
          value={card.profile ?? ""}
          onChange={(event) => updateCard({ ...card, profile: event.target.value })}
        />
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
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Concept</span>
        <input
          className={sbInputClass}
          value={card.concept ?? ""}
          onChange={(event) => updateCard({ ...card, concept: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Country</span>
        <input
          className={sbInputClass}
          value={card.country ?? ""}
          onChange={(event) => updateCard({ ...card, country: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Category</span>
        <input
          className={sbInputClass}
          value={card.category ?? ""}
          onChange={(event) => updateCard({ ...card, category: event.target.value })}
        />
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
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
      <legend className="px-1 text-sm text-sb-fg-muted">{label}</legend>
      {values.map((value, index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5" key={`${label}-${index}`}>
          <input
            className={sbInputClass}
            value={value}
            onChange={(event) => onChange(replaceArrayItem(values, index, event.target.value))}
          />
          <button type="button" className={sbControlButtonClass} onClick={() => onChange(removeArrayItem(values, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange([...values, ""])}>
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
          <button type="button" className={sbControlButtonClass} onClick={() => onChange(removeRecordKey(values, key))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange({ ...values, newKey: "" })}>
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
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
      <legend className="px-1 text-sm text-sb-fg-muted">Relations</legend>
      {relations.map((relation, index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5" key={`relation-${index}`}>
          <input
            className={sbInputClass}
            placeholder="target"
            value={relation.target}
            onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, target: event.target.value }))}
          />
          <input
            className={sbInputClass}
            placeholder="type"
            value={relation.type}
            onChange={(event) => onChange(replaceArrayItem(relations, index, { ...relation, type: event.target.value }))}
          />
          <button type="button" className={sbControlButtonClass} onClick={() => onChange(removeArrayItem(relations, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange([...relations, { target: "", type: "" }])}>
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
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
      <legend className="px-1 text-sm text-sb-fg-muted">Arc</legend>
      {arc.map((item, index) => (
        <div className="flex flex-col gap-1.5 border-b border-sb-border pb-2" key={`arc-${index}`}>
          <input
            className={sbInputClass}
            placeholder="stage"
            value={item.stage}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, stage: event.target.value }))}
          />
          <input
            className={sbInputClass}
            placeholder="summary"
            value={item.summary}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, summary: event.target.value }))}
          />
          <input
            className={sbInputClass}
            placeholder="sceneRef"
            value={item.sceneRef ?? ""}
            onChange={(event) => onChange(replaceArrayItem(arc, index, { ...item, sceneRef: event.target.value }))}
          />
          <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange(removeArrayItem(arc, index))}>
            삭제
          </button>
        </div>
      ))}
      <button type="button" className={`${sbControlButtonClass} self-start`} onClick={() => onChange([...arc, { stage: "", summary: "", sceneRef: "" }])}>
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

function parseSidebarScenesInitialData(value: unknown): SidebarScenesInitialData {
  if (isSidebarScenesInitialData(value)) {
    return value
  }

  return {
    title: "Scenes",
    scenes: [],
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

function isSidebarScenesInitialData(value: unknown): value is SidebarScenesInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<SidebarScenesInitialData>
  return (
    typeof candidate.title === "string" &&
    Array.isArray(candidate.scenes) &&
    typeof candidate.isStoryboardProject === "boolean" &&
    candidate.scenes.every(isSceneListItem)
  )
}

function isSceneListItem(value: unknown): value is SceneListItem {
  if (!value || typeof value !== "object") {
    return false
  }

  const s = value as Partial<SceneListItem>
  return (
    typeof s.stem === "string" &&
    typeof s.order === "number" &&
    typeof s.slug === "string" &&
    typeof s.sceneUri === "string" &&
    (s.status === "ready" || s.status === "stale" || s.status === "missing") &&
    typeof s.sceneMtime === "number"
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
