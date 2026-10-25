import type { StoryUri, SidebarCardSummary, BibleSubjectKind } from '@storyboard/story-model';

export interface ICardSidebarRepository {
  list(workspaceRoot: StoryUri, category: BibleSubjectKind): Promise<SidebarCardSummary[]>;
}
