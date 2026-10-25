import type { UsageSummaryByEntity } from '#model/contracts/ai';
import type { BibleSubjectKind } from '#model/format/bible';
import type { SidebarCardSummary } from './cards';
import type { RelationListCharacter } from './relations';
import type { SceneListItem } from './scenes';
import type { StudioSessionSnapshot, StudioTarget } from './studio';

export interface RelationGraphInitialData {
  readonly title: string;
  readonly characters: readonly RelationListCharacter[];
  readonly isStoryboardProject: boolean;
}

export interface SidebarCardsInitialData {
  readonly type: BibleSubjectKind;
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

export interface StudioInitialData {
  readonly title: string;
  readonly target: StudioTarget;
  readonly session?: StudioSessionSnapshot;
}
