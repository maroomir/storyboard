import * as vscode from 'vscode';

import type { StoryUri, StoryWorkspaceFolder, IWorkspaceLocator } from '@storyboard/story-engine';

export class VscodeWorkspaceLocator implements IWorkspaceLocator {
  public folders(): readonly StoryWorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }

  public folderFor(uri: StoryUri): StoryWorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri as vscode.Uri);
  }
}
