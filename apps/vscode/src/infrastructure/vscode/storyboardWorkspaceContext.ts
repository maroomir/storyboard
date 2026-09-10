import * as vscode from 'vscode';

import { anyStoryboardProjectInWorkspace } from './workspace';
import { workspaceReadyContextKey } from '@/contributionIds';

export async function refreshStoryboardWorkspaceContext(): Promise<void> {
  const ready = await anyStoryboardProjectInWorkspace();
  await vscode.commands.executeCommand('setContext', workspaceReadyContextKey, ready);
}

export function registerStoryboardWorkspaceContext(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  let watcherBucket = vscode.Disposable.from();

  const bindWatchers = (): void => {
    watcherBucket.dispose();
    const inner: vscode.Disposable[] = [];

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const pattern = new vscode.RelativePattern(folder, '.storyboard/project.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      inner.push(watcher);

      const scheduleRefresh = (): void => {
        void refreshStoryboardWorkspaceContext();
      };

      inner.push(watcher.onDidCreate(scheduleRefresh));
      inner.push(watcher.onDidDelete(scheduleRefresh));
      inner.push(watcher.onDidChange(scheduleRefresh));
    }

    watcherBucket = vscode.Disposable.from(...inner);
  };

  void refreshStoryboardWorkspaceContext();
  bindWatchers();

  const folderChange = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    bindWatchers();
    void refreshStoryboardWorkspaceContext();
  });

  const composite = vscode.Disposable.from(
    folderChange,
    new vscode.Disposable(() => watcherBucket.dispose()),
  );

  context.subscriptions.push(composite);
  return composite;
}
