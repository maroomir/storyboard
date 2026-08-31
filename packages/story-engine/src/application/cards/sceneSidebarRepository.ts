import type { StoryUri } from '../../paths/storyUri';
import type { SceneListItem } from '../../shared/messaging/scenes';

export interface ISceneSidebarRepository {
  list(workspaceRoot: StoryUri): Promise<SceneListItem[]>;
}
