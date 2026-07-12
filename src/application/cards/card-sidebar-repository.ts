import type * as vscode from 'vscode';

import type { SidebarCardSummary } from '../../shared/messaging';

export type SidebarCardCategory = 'background' | 'character';

export interface ICardSidebarRepository {
  list(workspaceRoot: vscode.Uri, category: SidebarCardCategory): Promise<SidebarCardSummary[]>;
}
