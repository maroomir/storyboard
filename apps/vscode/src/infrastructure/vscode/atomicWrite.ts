import type { StoryUri } from '@storyboard/story-model';
import * as vscode from 'vscode';

async function deleteTemporaryFileIfCreated(temporary: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(temporary);
  } catch {
    return;
  }
}

export async function writeFileAtomically(uri: StoryUri, content: Uint8Array): Promise<void> {
  const target: vscode.Uri = uri as vscode.Uri;
  const temporary: vscode.Uri = target.with({
    path: `${target.path}.tmp-${Date.now().toString(36)}`,
  });

  try {
    await vscode.workspace.fs.writeFile(temporary, content);
    await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
  } catch (error) {
    await deleteTemporaryFileIfCreated(temporary);
    throw error;
  }
}
