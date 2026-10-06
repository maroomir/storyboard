import type {
  AiProviderId,
  StoryboardSettingKind,
  CompositionKind,
  ContractFieldKey,
  PointOfView,
  BackgroundCard,
  BibleFact,
  CharacterCard,
  NarratorCard,
  NarrativeTense,
  NarratorKnowledge,
  NarratorPerson,
  NovelRunMode,
  NovelStageName,
} from '@storyboard/story-model/contracts';

// NOTE: 이 파일은 main 과 렌더러가 함께 보는 응답 모양이다. 렌더러 번들에 들어가므로 값은 없고
// 타입만 둔다 — 값이 필요한 표는 패키지의 /contracts 진입점에서 직접 가져온다.

export type UiLanguage = 'ko' | 'en';

export interface RecentWorkspace {
  readonly path: string;
  readonly title: string;
  readonly openedAt: string;
}

export interface AppBootstrap {
  readonly version: string;
  readonly language: UiLanguage;
  readonly recentWorkspaces: readonly RecentWorkspace[];
  readonly isProviderReady: boolean;
  readonly defaultParentDirectory: string;
}

export type SceneStatus = 'seed' | 'drafted' | 'warning' | 'generating';

export interface TocScene {
  readonly stem: string;
  readonly order: number;
  readonly title: string;
  readonly status: SceneStatus;
  readonly length: number;
  readonly targetLength?: number;
}

export interface TocChapter {
  // Empty for a workspace without an outline yet: its scenes sit in one untitled group.
  readonly title: string;
  readonly scenes: readonly TocScene[];
}

export interface WorkspaceLockNotice {
  readonly message: string;
}

export interface WorkspaceOverview {
  readonly path: string;
  readonly title: string;
  readonly genre?: string;
  readonly pov?: PointOfView;
  readonly composition?: CompositionKind;
  readonly targetWordCount?: number;
  readonly chapters: readonly TocChapter[];
  readonly totalLength: number;
  readonly missingContractFields: readonly ContractFieldKey[];
  // Set only when another app holds the workspace. The desktop's own run is reported through the
  // run snapshot instead.
  readonly foreignLock?: WorkspaceLockNotice;
}

export interface DraftDocument {
  readonly stem: string;
  readonly exists: boolean;
  readonly body: string;
  readonly warnings: readonly string[];
}

export interface NarrationSummary {
  readonly person?: NarratorPerson;
  readonly knowledge?: NarratorKnowledge;
  readonly tense?: NarrativeTense;
  readonly focal?: string;
  readonly narratorName?: string;
}

export interface NoteCard {
  readonly id: string;
  readonly name: string;
  readonly summary?: string;
}

export interface StoryFactNote {
  readonly text: string;
  readonly throughScene?: number;
  readonly witnesses: readonly string[];
}

export interface ReviewNote {
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly instructions: readonly string[];
}

export interface SceneNotes {
  readonly stem: string;
  readonly title: string;
  readonly chapterTitle?: string;
  readonly narration?: NarrationSummary;
  readonly thread: string;
  readonly summary?: string;
  readonly beats: readonly string[];
  readonly mood?: string;
  readonly characters: readonly NoteCard[];
  readonly background?: NoteCard;
  readonly facts: readonly StoryFactNote[];
  readonly review?: ReviewNote;
  readonly warnings: readonly string[];
  readonly length: number;
  readonly targetLength?: number;
}

export type RunKind = 'novel' | 'scene';

export type RunStatus = 'idle' | 'running' | 'pausing' | 'waiting-approval';

export interface RunLogLine {
  readonly at: string;
  readonly stage?: NovelStageName;
  readonly message: string;
  readonly tone: 'info' | 'warn' | 'error';
}

export interface RunApprovalRequest {
  readonly kind: 'outline' | 'chapter' | 'review';
  readonly info: string;
}

export type RunOutcome = 'completed' | 'paused' | 'cancelled' | 'failed' | 'budget';

export interface RunSnapshot {
  readonly status: RunStatus;
  readonly kind?: RunKind;
  readonly mode?: NovelRunMode;
  readonly sceneStem?: string;
  readonly currentStage?: NovelStageName;
  readonly completedStages: readonly NovelStageName[];
  readonly approval?: RunApprovalRequest;
  readonly log: readonly RunLogLine[];
  readonly spentUsd: number;
  readonly spentTokens: number;
  readonly hasUnpricedUsage: boolean;
  readonly budgetUsd: number;
  readonly projectSpentUsd: number;
  readonly lastOutcome?: { readonly outcome: RunOutcome; readonly message: string };
  // A novel run that stopped and can pick up where it left off.
  readonly resumable?: {
    readonly mode: NovelRunMode;
    readonly completedStages: readonly NovelStageName[];
  };
}

export interface ProviderOption {
  readonly id: AiProviderId;
  readonly label: string;
  readonly requiresApiKey: boolean;
  readonly hasApiKey: boolean;
  readonly model: string;
  readonly models: readonly { readonly id: string; readonly label: string }[];
  readonly isAdvanced: boolean;
}

export interface SettingEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: StoryboardSettingKind;
  readonly value: boolean | number | string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly isBasic: boolean;
}

export interface DesktopSettings {
  readonly defaultProvider?: AiProviderId;
  readonly providers: readonly ProviderOption[];
  readonly entries: readonly SettingEntry[];
  readonly language: UiLanguage;
  readonly ollamaBaseUrl: string;
}

export type BibleCardKind = 'character' | 'background' | 'narrator';

export interface BibleCardSummary {
  readonly kind: BibleCardKind;
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
}

export type BibleCard = CharacterCard | BackgroundCard | NarratorCard;

export interface CanonFact extends BibleFact {
  readonly subjectName?: string;
}

export interface SnapshotEntry {
  readonly id: string;
  readonly message: string;
  readonly time: string;
}
