// The contract is the engine's, not a copy of it. A second declaration here is how the two
// drifted before: same names, no compiler linking them.
// The contract is the engine's, not a copy of it. A second declaration here is how the two
// drifted before: same names, no compiler linking them — and the swap found real gaps.
import type {
  CardCollectProposal,
  SceneListItem,
  SidebarCardSummary,
  StoryboardRequestMethod,
  StudioCardStage,
  StudioCardStageRelation,
  StudioChatTurn,
  StudioEntity,
  StudioEntityKind,
  StudioFollowUpTarget,
  StudioPendingFollowUp,
  StudioProposalStatus,
  StudioProposalTurn,
  StudioSceneStage,
  StudioSessionSnapshot,
  StudioSessionSummary,
  StudioStage,
  StudioStageCard,
  StudioTarget,
  StudioValidation,
} from '@storyboard/story-engine/contracts';

export type {
  CardCollectProposal,
  SceneListItem,
  SidebarCardSummary,
  StoryboardRequestMethod,
  StudioCardStage,
  StudioCardStageRelation,
  StudioChatTurn,
  StudioEntity,
  StudioEntityKind,
  StudioFollowUpTarget,
  StudioPendingFollowUp,
  StudioProposalStatus,
  StudioProposalTurn,
  StudioSceneStage,
  StudioSessionSnapshot,
  StudioSessionSummary,
  StudioStage,
  StudioStageCard,
  StudioTarget,
  StudioValidation,
};

export type CardType = 'character' | 'location' | 'temporal' | 'social';

export type SidebarCardCategory = 'character' | 'background';

export type CharacterRole = 'main' | 'supporting' | 'extra';

type CardAttributeValue = string | number | boolean | null;

export interface CharacterRelation {
  readonly target: string;
  readonly type: string;
}

export interface CharacterArc {
  readonly stage: string;
  readonly summary: string;
  readonly sceneRef?: string;
}

export interface StoryboardCard {
  readonly type: CardType;
  readonly id: string;
  readonly name: string;
  readonly description?: readonly string[];
  readonly profile?: string;
  readonly role?: CharacterRole;
  readonly aliases?: readonly string[];
  readonly voice?: readonly string[];
  readonly desire?: readonly string[];
  readonly locationKind?: 'place' | 'affiliation';
  readonly time?: string;
  readonly weather?: string;
  readonly senses?: readonly string[];
  readonly characterIds?: readonly string[];
  readonly attributes?: Record<string, CardAttributeValue>;
  readonly tags?: readonly string[];
  readonly traits?: readonly string[];
  readonly relations?: readonly CharacterRelation[];
  readonly arc?: readonly CharacterArc[];
  readonly recentDialogues?: readonly string[];
}

export interface SceneGrounding {
  readonly incident?: string;
  readonly place?: string;
  readonly relation?: string;
  readonly time?: string;
}

export interface SceneCard {
  readonly type: 'scene';
  readonly id: string;
  readonly title?: string;
  readonly characters?: readonly string[];
  readonly location?: string;
  readonly mood?: string;
  readonly relationStage?: string;
  readonly targetWordCount?: number;
  readonly grounding?: SceneGrounding;
  readonly purpose?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly endState?: string;
  readonly foreshadowing?: readonly string[];
  readonly neededCanon?: readonly string[];
  readonly summary?: string;
}

export type EditorCard = StoryboardCard | SceneCard;

export interface CharacterRosterEntry {
  readonly id: string;
  readonly name: string;
  readonly role?: CharacterRole;
}

export interface CardEditorInitialData {
  readonly documentUri: string;
  readonly rawText: string;
  readonly card?: EditorCard;
  readonly imageUri?: string;
  readonly characterRoster?: readonly CharacterRosterEntry[];
  readonly error?: string;
}

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, number>>;
  readonly characters: Readonly<Record<string, number>>;
  readonly backgrounds: Readonly<Record<string, number>>;
  readonly totalUsd: number;
}

export interface SidebarCardsInitialData {
  readonly type: SidebarCardCategory;
  readonly title: string;
  readonly cards: readonly SidebarCardSummary[];
  readonly isStoryboardProject: boolean;
  readonly usage: UsageSummaryByEntity;
}

export interface SidebarScenesInitialData {
  readonly title: string;
  readonly scenes: readonly SceneListItem[];
  readonly isStoryboardProject: boolean;
  readonly usage: UsageSummaryByEntity;
}

export type StudioReviewState = 'unreviewed' | 'clean' | 'issues';

export type StudioValidationState = 'pass' | 'warn' | 'skipped';

export interface StudioValidationWarning {
  readonly message: string;
  readonly source?: string;
}

export interface StudioCardFieldChange {
  readonly field: string;
  readonly value: string | readonly string[] | readonly Readonly<Record<string, string>>[];
}

export interface StudioDraftReplacement {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly oldText: string;
  readonly newText: string;
}

export type StudioPatch =
  | { readonly target: 'card'; readonly changes: readonly StudioCardFieldChange[] }
  | { readonly target: 'draft'; readonly replacements: readonly StudioDraftReplacement[] };

export type StudioChatStage = 'thinking' | 'looking-up' | 'invoking' | 'validating' | 'idle';

export interface StudioInitialData {
  readonly title: string;
  readonly target: StudioTarget;
  readonly session?: StudioSessionSnapshot;
}

export interface StoryboardEventMessage {
  readonly type: 'event';
  readonly method:
    | 'cards.changed'
    | 'cards.listChanged'
    | 'scenes.listChanged'
    | 'relations.listChanged'
    | 'studio.targetChanged'
    | 'studio.chat.progress'
    | 'usage.changed'
    | 'ai.generateStream.chunk';
  readonly payload: unknown;
}

declare global {
  interface Window {
    readonly __STORYBOARD_VIEW__?: string;
    readonly __STORYBOARD_INITIAL_DATA__?: unknown;
    readonly acquireVsCodeApi?: () => {
      readonly postMessage: (message: unknown) => void;
    };
  }
}
