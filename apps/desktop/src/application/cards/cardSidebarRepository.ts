import type { SidebarCardSummary, StoryUri } from '@storyboard/story-engine';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: StoryUri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
