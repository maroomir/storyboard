import type { StoryUri, SceneListItem } from '@storyboard/story-model';

export interface ISceneSidebarRepository {
  list(workspaceRoot: StoryUri): Promise<SceneListItem[]>;
}
