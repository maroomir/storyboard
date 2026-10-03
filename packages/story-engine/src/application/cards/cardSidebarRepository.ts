import type { StoryUri } from '@storyboard/story-model';
import type { SidebarCardSummary } from '#engine/shared/messaging/cards';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: StoryUri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
