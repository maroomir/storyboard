export type CardType = "character" | "location" | "temporal" | "social"

export type SidebarCardCategory = "character" | "background"

export type CharacterRole = "main" | "supporting" | "extra"

export type StoryboardRequestMethod =
  | "cards.write"
  | "cards.writeRaw"
  | "cards.collect"
  | "cards.applyCollect"
  | "cards.previewCollect"
  | "cards.open"
  | "cards.delete"
  | "scenes.openScene"
  | "scenes.openDraft"
  | "scenes.generateDraft"
  | "studio.runAction"
  | "studio.stage"
  | "studio.session.save"
  | "studio.session.list"
  | "studio.session.load"
  | "ai.generateStream"
  | "usage.read"

interface CardCollectProposalBase {
  readonly id: string
  readonly sourceScenes: readonly string[]
}

export type CardCollectProposal =
  | (CardCollectProposalBase & {
      readonly kind: "attribute"
      readonly key: string
      readonly value: string
      readonly before?: string
    })
  | (CardCollectProposalBase & {
      readonly kind: "relation"
      readonly target: string
      readonly type: string
      readonly before?: string
    })
  | (CardCollectProposalBase & {
      readonly kind: "arc"
      readonly stage?: string
      readonly summary: string
      readonly sceneRef: string
      readonly before?: string
    })
  | (CardCollectProposalBase & { readonly kind: "trait"; readonly value: string })
  | (CardCollectProposalBase & { readonly kind: "recentDialogue"; readonly value: string })
  | (CardCollectProposalBase & { readonly kind: "descriptionLine"; readonly value: string })
  | (CardCollectProposalBase & { readonly kind: "voiceLine"; readonly value: string })
  | (CardCollectProposalBase & { readonly kind: "desireLine"; readonly value: string })
  | (CardCollectProposalBase & { readonly kind: "sense"; readonly value: string })
  | (CardCollectProposalBase & {
      readonly kind: "scalar"
      readonly field: "time" | "weather"
      readonly before?: string
      readonly after: string
    })
  | (CardCollectProposalBase & { readonly kind: "characterId"; readonly value: string })

type CardAttributeValue = string | number | boolean | null

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
  readonly description?: readonly string[]
  readonly profile?: string
  readonly role?: CharacterRole
  readonly aliases?: readonly string[]
  readonly voice?: readonly string[]
  readonly desire?: readonly string[]
  readonly locationKind?: "place" | "affiliation"
  readonly time?: string
  readonly weather?: string
  readonly senses?: readonly string[]
  readonly characterIds?: readonly string[]
  readonly attributes?: Record<string, CardAttributeValue>
  readonly tags?: readonly string[]
  readonly traits?: readonly string[]
  readonly relations?: readonly CharacterRelation[]
  readonly arc?: readonly CharacterArc[]
  readonly recentDialogues?: readonly string[]
}

export interface SceneGrounding {
  readonly incident?: string
  readonly place?: string
  readonly relation?: string
  readonly time?: string
}

export interface SceneCard {
  readonly type: "scene"
  readonly id: string
  readonly title?: string
  readonly characters?: readonly string[]
  readonly location?: string
  readonly mood?: string
  readonly relationStage?: string
  readonly targetWordCount?: number
  readonly grounding?: SceneGrounding
  readonly purpose?: string
  readonly conflict?: string
  readonly twist?: string
  readonly emotionalShift?: string
  readonly endState?: string
  readonly foreshadowing?: readonly string[]
  readonly neededCanon?: readonly string[]
  readonly summary?: string
}

export type EditorCard = StoryboardCard | SceneCard

export interface CharacterRosterEntry {
  readonly id: string
  readonly name: string
  readonly role?: CharacterRole
}

export interface CardEditorInitialData {
  readonly documentUri: string
  readonly rawText: string
  readonly card?: EditorCard
  readonly imageUri?: string
  readonly characterRoster?: readonly CharacterRosterEntry[]
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
  readonly outlineStale?: boolean
}

export interface SidebarScenesInitialData {
  readonly title: string
  readonly scenes: readonly SceneListItem[]
  readonly isStoryboardProject: boolean
  readonly usage: UsageSummaryByEntity
}

export type StudioEntityKind = "character" | "background" | "scene" | "project"

export interface StudioEntity {
  readonly kind: StudioEntityKind
  readonly key: string
}

export interface StudioTarget {
  readonly kind: "draft" | "scene" | "character" | "background" | "project" | "none"
  readonly label?: string
  readonly entity?: StudioEntity
  readonly sceneUri?: string
  readonly draftUri?: string
  readonly cardUri?: string
  readonly hasSelection: boolean
  readonly draftExists?: boolean
}

export interface StudioStageCard {
  readonly kind: "character" | "background"
  readonly name: string
}

export type StudioReviewState = "unreviewed" | "clean" | "issues"

export interface StudioSceneStage {
  readonly kind: "scene"
  readonly sceneStem: string
  readonly title?: string
  readonly draftLength?: number
  readonly draftUpdatedAt?: string
  readonly draftRevision?: number
  readonly review: StudioReviewState
  readonly cards: readonly StudioStageCard[]
}

export interface StudioCardStageRelation {
  readonly target: string
  readonly type: string
}

export interface StudioCardStage {
  readonly kind: "card"
  readonly cardKind: "character" | "background"
  readonly cardId: string
  readonly name: string
  readonly role?: string
  readonly relations: readonly StudioCardStageRelation[]
  readonly appearsInScenes: readonly string[]
}

export type StudioStage = StudioSceneStage | StudioCardStage

export type StudioProposalStatus = "pending" | "applied" | "rejected" | "failed"

export type StudioValidationState = "pass" | "warn" | "skipped"

export interface StudioValidationWarning {
  readonly message: string
  readonly source?: string
}

export interface StudioValidation {
  readonly state: StudioValidationState
  readonly warnings: readonly StudioValidationWarning[]
}

export interface StudioCardFieldChange {
  readonly field: string
  readonly value: string | readonly string[] | readonly Readonly<Record<string, string>>[]
}

export interface StudioDraftReplacement {
  readonly startOffset: number
  readonly endOffset: number
  readonly oldText: string
  readonly newText: string
}

export type StudioPatch =
  | { readonly target: "card"; readonly changes: readonly StudioCardFieldChange[] }
  | { readonly target: "draft"; readonly replacements: readonly StudioDraftReplacement[] }

export interface StudioFollowUpTarget {
  readonly kind: "character" | "background" | "scene"
  readonly key: string
  readonly reason: string
  readonly instruction: string
  readonly targetFile: string
}

export interface StudioPendingFollowUp {
  readonly id: string
  readonly origin: StudioEntity
  readonly reason: string
  readonly instruction: string
}

export interface StudioProposalTurn {
  readonly id: string
  readonly role: "assistant"
  readonly kind: "proposal"
  readonly summary: string
  readonly message?: string
  readonly patch: StudioPatch
  readonly targetFile: string
  readonly baselineHash: string
  readonly validation: StudioValidation
  readonly status: StudioProposalStatus
  readonly errorMessage?: string
  readonly followUps?: readonly StudioFollowUpTarget[]
}

export type StudioChatTurn =
  | { readonly id: string; readonly role: "user"; readonly text: string }
  | {
      readonly id: string
      readonly role: "assistant"
      readonly kind: "say"
      readonly message: string
      readonly followUps?: readonly StudioFollowUpTarget[]
    }
  | {
      readonly id: string
      readonly role: "assistant"
      readonly kind: "ask"
      readonly question: string
      readonly options: readonly string[]
    }
  | StudioProposalTurn
  | {
      readonly id: string
      readonly role: "assistant"
      readonly kind: "result"
      readonly message: string
    }

export type StudioChatStage = "thinking" | "looking-up" | "validating" | "idle"

export interface StudioSessionSummary {
  readonly id: string
  readonly title: string
  readonly updatedAt: string
  readonly turnCount: number
  readonly hasAppliedChanges: boolean
}

export interface StudioSessionSnapshot {
  readonly id: string
  readonly entity: StudioEntity
  readonly createdAt: string
  readonly updatedAt: string
  readonly title: string
  readonly hasAppliedChanges: boolean
  readonly turns: readonly StudioChatTurn[]
}

export interface StudioInitialData {
  readonly title: string
  readonly target: StudioTarget
  readonly session?: StudioSessionSnapshot
}

export interface StoryboardEventMessage {
  readonly type: "event"
  readonly method:
    | "cards.changed"
    | "cards.listChanged"
    | "scenes.listChanged"
    | "relations.listChanged"
    | "studio.targetChanged"
    | "studio.chat.progress"
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
