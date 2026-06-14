import * as vscode from "vscode"

import type { StoryboardProjectPaths } from "../core/pathConventions"

export async function ensureBibleCacheDirectory(paths: StoryboardProjectPaths): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.bibleCacheDirectory)
}

export function bibleCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): vscode.Uri {
  return vscode.Uri.joinPath(paths.bibleCacheDirectory, `${sceneStem}.json`)
}
