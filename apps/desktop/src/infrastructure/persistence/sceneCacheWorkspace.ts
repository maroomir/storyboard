import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '../vscode/pathConventions';

export function sceneCacheFilePath(paths: StoryboardProjectPaths, sceneStem: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.sceneCacheDirectory, `${sceneStem}.json`);
}
