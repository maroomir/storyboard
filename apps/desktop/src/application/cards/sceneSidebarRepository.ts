import type * as vscode from 'vscode';

import type { SceneListItem } from '@storyboard/story-engine';

export interface ISceneSidebarRepository {
  list(workspaceRoot: vscode.Uri): Promise<SceneListItem[]>;
}
