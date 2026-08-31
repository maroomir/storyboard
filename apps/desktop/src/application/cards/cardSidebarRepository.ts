import type * as vscode from 'vscode';

import type { SidebarCardSummary } from '@storyboard/story-engine';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: vscode.Uri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
