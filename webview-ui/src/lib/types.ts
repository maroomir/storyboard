export type CardType = "character" | "location" | "temporal" | "social"

export type SidebarCardCategory = "character" | "background"

export type CharacterRole = "main" | "supporting" | "extra"

export type StoryboardRequestMethod =
  | "cards.write"
  | "cards.open"
  | "cards.delete"
  | "scenes.openScene"
  | "scenes.openDraft"
  | "scenes.generateDraft"
  | "ai.generateStream"
  | "usage.read"

export type CardAttributeValue = string | number | boolean | null

export interface CharacterRelation {
  readonly target: string
  readonly type: string
}

export interface CharacterArc {
  readonly stage: string
  readonly summary: string
  readonly sceneRef?: string
}

export interface StoryboardCard {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly profile?: string
  readonly role?: string
  readonly locationKind?: "place" | "affiliation"
  readonly characterIds?: readonly string[]
  readonly attributes?: Record<string, CardAttributeValue>
  readonly tags?: readonly string[]
  readonly traits?: readonly string[]
  readonly relations?: readonly CharacterRelation[]
  readonly arc?: readonly CharacterArc[]
  readonly recentDialogues?: readonly string[]
}

export interface CardEditorInitialData {
  readonly documentUri: string
  readonly rawText: string
  readonly card?: StoryboardCard
  readonly imageUri?: string
  readonly error?: string
}

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, number>>
  readonly characters: Readonly<Record<string, number>>
  readonly backgrounds: Readonly<Record<string, number>>
  readonly totalUsd: number
}

export interface SidebarCardSummary {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly uri: string
  readonly description?: string
  readonly error?: string
  readonly role?: CharacterRole
}

export interface SidebarCardsInitialData {
  readonly type: SidebarCardCategory
  readonly title: string
  readonly cards: readonly SidebarCardSummary[]
  readonly isStoryboardProject: boolean
  readonly usage: UsageSummaryByEntity
}

export interface StoryboardRequestMessage {
  readonly protocolVersion: "1.0.0"
  readonly type: "request"
  readonly id: string
  readonly method: StoryboardRequestMethod
  readonly payload: Record<string, unknown>
}

export interface SceneListItem {
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

export interface SidebarScenesInitialData {
  readonly title: string
  readonly scenes: readonly SceneListItem[]
  readonly isStoryboardProject: boolean
  readonly usage: UsageSummaryByEntity
}

export interface StoryboardEventMessage {
  readonly type: "event"
  readonly method:
    | "cards.changed"
    | "cards.listChanged"
    | "scenes.listChanged"
    | "relations.listChanged"
    | "usage.changed"
    | "ai.generateStream.chunk"
  readonly payload: unknown
}

declare global {
  interface Window {
    readonly __STORYBOARD_VIEW__?: string
    readonly __STORYBOARD_INITIAL_DATA__?: unknown
    readonly acquireVsCodeApi?: () => {
      readonly postMessage: (message: unknown) => void
    }
  }
}

