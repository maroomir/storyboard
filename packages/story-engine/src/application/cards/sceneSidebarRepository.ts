import type { StoryUri } from '@storyboard/story-format';
import type { SceneListItem } from '../../shared/messaging/scenes';

export interface ISceneSidebarRepository {
  list(workspaceRoot: StoryUri): Promise<SceneListItem[]>;
}
