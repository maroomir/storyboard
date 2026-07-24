import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '../vscode/pathConventions';

export async function ensureCardCacheDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.cardCacheDirectory);
}

export function cardCandidateFilePath(
  paths: StoryboardProjectPaths,
  sceneStem: string,
): vscode.Uri {
  return vscode.Uri.joinPath(paths.cardCacheDirectory, `${sceneStem}.json`);
}
