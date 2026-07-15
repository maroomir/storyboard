import * as vscode from 'vscode';

export function resolveWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}
