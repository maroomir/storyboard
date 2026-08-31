import type { StoryUri, StoryWorkspaceFolder, WorkspaceLocator } from '@storyboard/story-engine';

// The CLI runs against exactly one workspace — the directory it was pointed at — so locating a
// file's workspace is a containment test rather than a lookup.
export class NodeWorkspaceLocator implements WorkspaceLocator {
  public constructor(private readonly root: StoryWorkspaceFolder) {}

  public folders(): readonly StoryWorkspaceFolder[] {
    return [this.root];
  }

  public folderFor(uri: StoryUri): StoryWorkspaceFolder | undefined {
    const rootPath = this.root.uri.path.replace(/\/$/, '');
    return uri.path === rootPath || uri.path.startsWith(`${rootPath}/`) ? this.root : undefined;
  }
}
