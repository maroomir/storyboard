import type {
  CharacterArc,
  RelationLink,
  StudioValidationVerdict,
  SceneGrounding,
  NarratorSummary,
  CharacterRosterEntry,
  UsageCacheAmount,
  UsageAmount,
  UsageSummaryByEntity,
  StudioValidationWarning,
  StudioCardFieldChange,
  StudioDraftReplacement,
  SidebarCardsInitialData,
  SidebarScenesInitialData,
  StudioInitialData,
  CardType,
  CharacterRole,
  StudioValidationState,
  CardCollectProposal,
  EntityKind,
  SceneListItem,
  SidebarCardSummary,
  StoryboardRequestMethod,
  StudioCardStage,
  StudioChatTurn,
  StudioEntity,
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
  NarratorCard,
  SceneBeat,
  LocationKind,
} from '@storyboard/story-model/contracts';

export type {
  CharacterArc,
  SceneGrounding,
  NarratorSummary,
  CharacterRosterEntry,
  UsageCacheAmount,
  UsageAmount,
  UsageSummaryByEntity,
  StudioValidationWarning,
  StudioCardFieldChange,
  StudioDraftReplacement,
  SidebarCardsInitialData,
  SidebarScenesInitialData,
  StudioInitialData,
  CardType,
  CharacterRole,
  StudioValidationState,
  CardCollectProposal,
  SceneListItem,
  SidebarCardSummary,
  StoryboardRequestMethod,
  StudioCardStage,
  RelationLink,
  StudioChatTurn,
  StudioEntity,
  EntityKind,
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
  StudioValidationVerdict,
};

type CardAttributeValue = string | number | boolean | null;

export interface StoryboardCard {
  readonly type: CardType;
  readonly id: string;
  readonly name: string;
  readonly description?: readonly string[];
  readonly profile?: string;
  readonly role?: CharacterRole;
  readonly aliases?: readonly string[];
  readonly voice?: readonly string[];
  readonly catchphrases?: readonly string[];
  readonly desire?: readonly string[];
  readonly locationKind?: LocationKind;
  readonly time?: string;
  readonly weather?: string;
  readonly senses?: readonly string[];
  readonly characterIds?: readonly string[];
  readonly attributes?: Record<string, CardAttributeValue>;
  readonly tags?: readonly string[];
  readonly traits?: readonly string[];
  readonly relations?: readonly RelationLink[];
  readonly arc?: readonly CharacterArc[];
  readonly recentDialogues?: readonly string[];
}

export interface SceneCard {
  readonly type: 'scene';
  readonly id: string;
  readonly title?: string;
  readonly characters?: readonly string[];
  readonly location?: string;
  readonly mood?: string;
  readonly relationStage?: string;
  readonly povCharacter?: string;
  readonly narrator?: string;
  readonly thread?: string;
  readonly targetWordCount?: number;
  readonly grounding?: SceneGrounding;
  readonly purpose?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly endState?: string;
  readonly foreshadowing?: readonly string[];
  readonly neededCanon?: readonly string[];
  readonly beats?: readonly SceneBeat[];
  readonly summary?: string;
}

export type { NarratorCard };

export type EditorCard = StoryboardCard | SceneCard | NarratorCard;

export interface CardEditorInitialData {
  readonly documentUri: string;
  readonly rawText: string;
  readonly card?: EditorCard;
  readonly imageUri?: string;
  readonly characterRoster?: readonly CharacterRosterEntry[];
  readonly narratorRoster?: readonly NarratorSummary[];
  readonly error?: string;
}

export type { SidebarRunnableCommand } from '@storyboard/story-model/contracts';

export type StudioReviewState = 'unreviewed' | 'clean' | 'issues';

export type StudioPatch =
  | { readonly target: 'card'; readonly changes: readonly StudioCardFieldChange[] }
  | { readonly target: 'draft'; readonly replacements: readonly StudioDraftReplacement[] };

export type StudioChatStage = 'thinking' | 'looking-up' | 'invoking' | 'validating' | 'idle';

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
