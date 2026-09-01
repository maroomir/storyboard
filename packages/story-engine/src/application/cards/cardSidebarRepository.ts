import type { StoryUri } from '@storyboard/story-format';
import type { SidebarCardSummary } from '#engine/shared/messaging/cards';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: StoryUri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
