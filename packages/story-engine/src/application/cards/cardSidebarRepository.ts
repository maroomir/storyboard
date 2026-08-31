import type { StoryUri } from '../../paths/storyUri';
import type { SidebarCardSummary } from '../../shared/messaging/cards';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: StoryUri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
