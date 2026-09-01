import type { StoryUri, StoryWorkspaceFolder } from '@storyboard/story-format';

// Which workspaces are open, and which one a file belongs to, is host knowledge: the extension asks
// VSCode, while a CLI has exactly one workspace — the directory it was pointed at.
export interface IWorkspaceLocator {
  folders(): readonly StoryWorkspaceFolder[];
  folderFor(uri: StoryUri): StoryWorkspaceFolder | undefined;
}
