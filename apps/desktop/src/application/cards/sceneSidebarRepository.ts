import type { SceneListItem, StoryUri } from '@storyboard/story-engine';

export interface ISceneSidebarRepository {
  list(workspaceRoot: StoryUri): Promise<SceneListItem[]>;
}
