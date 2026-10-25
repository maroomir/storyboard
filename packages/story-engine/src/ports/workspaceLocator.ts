import type { StoryUri, StoryWorkspaceFolder } from '@storyboard/story-model';

export interface IWorkspaceLocator {
  folders(): readonly StoryWorkspaceFolder[];
  folderFor(uri: StoryUri): StoryWorkspaceFolder | undefined;
}
