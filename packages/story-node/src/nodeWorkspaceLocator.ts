import type { StoryUri, StoryWorkspaceFolder } from '@storyboard/story-model';
import type { IWorkspaceLocator } from '@storyboard/story-engine';

export class NodeWorkspaceLocator implements IWorkspaceLocator {
  public constructor(private readonly root: StoryWorkspaceFolder) {}

  public folders(): readonly StoryWorkspaceFolder[] {
    return [this.root];
  }

  public folderFor(uri: StoryUri): StoryWorkspaceFolder | undefined {
    const rootPath: string = this.root.uri.path.replace(/\/$/, '');
    return uri.path === rootPath || uri.path.startsWith(`${rootPath}/`) ? this.root : undefined;
  }
}
