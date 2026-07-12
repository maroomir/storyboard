import type * as vscode from 'vscode';

import type { SceneListItem } from '../../shared/messaging/scenes';

export interface ISceneSidebarRepository {
  list(workspaceRoot: vscode.Uri): Promise<SceneListItem[]>;
}
