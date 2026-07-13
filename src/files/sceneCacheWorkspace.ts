import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '../infrastructure/vscode/pathConventions';

export async function ensureSceneCacheDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.sceneCacheDirectory);
}

export function sceneCacheFilePath(paths: StoryboardProjectPaths, sceneStem: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.sceneCacheDirectory, `${sceneStem}.json`);
}
