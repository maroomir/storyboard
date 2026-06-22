import * as vscode from "vscode"

import { summaryFileName } from "./chapterSummaries"
import { type StoryboardProjectPaths } from "./pathConventions"
import {
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "./sceneContext"

export const vscodeFsAdapter = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export const sceneContextFileSystem: SceneContextWorkspaceFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  readDirectory: async (uri: unknown): Promise<[string, { type: "file" | "directory" }][]> => {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri)
    return entries.map(([name, fileType]) => [
      name,
      { type: fileType === vscode.FileType.Directory ? ("directory" as const) : ("file" as const) }
    ])
  }
}

export function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    bibleCanon: paths.bibleCanon,
    manuscriptSummary: vscode.Uri.joinPath(paths.manuscriptDirectory, summaryFileName),
    joinPath: (base: unknown, ...segments: string[]): vscode.Uri =>
      vscode.Uri.joinPath(base as vscode.Uri, ...segments)
  }
}
