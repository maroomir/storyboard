import * as vscode from 'vscode';

import {
  UsageLedgerRecorder,
  type StoryUri,
  type UsageLedgerFileSystem,
} from '@storyboard/story-engine';

// The ledger itself lives in the engine so every app records cost the same way; the extension only
// adds the dispose hook its lifecycle expects.
export class UsageRecorder extends UsageLedgerRecorder implements vscode.Disposable {
  public dispose(): void {
    this.clearListeners();
  }
}

export function createVscodeUsageLedgerFileSystem(): UsageLedgerFileSystem {
  return {
    readFile: (uri: StoryUri) => Promise.resolve(vscode.workspace.fs.readFile(uri as vscode.Uri)),
    writeFile: (uri: StoryUri, content: Uint8Array) =>
      Promise.resolve(vscode.workspace.fs.writeFile(uri as vscode.Uri, content)),
    createDirectory: (uri: StoryUri) =>
      Promise.resolve(vscode.workspace.fs.createDirectory(uri as vscode.Uri)),
  };
}
