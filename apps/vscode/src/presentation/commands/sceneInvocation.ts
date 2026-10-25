import * as vscode from 'vscode';

export function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri?.scheme === 'file') {
    return invokedUri;
  }

  const document: vscode.TextDocument | undefined = vscode.window.activeTextEditor?.document;
  return document?.uri.scheme === 'file' ? document.uri : undefined;
}
