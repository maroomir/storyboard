import * as vscode from 'vscode';

function readActiveCustomEditorUri(): vscode.Uri | undefined {
  const input: unknown = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;

  return input instanceof vscode.TabInputCustom && input.uri.scheme === 'file'
    ? input.uri
    : undefined;
}

export function resolveActiveFileUri(): vscode.Uri | undefined {
  const document: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;

  return document?.uri.scheme === 'file' ? document.uri : readActiveCustomEditorUri();
}
