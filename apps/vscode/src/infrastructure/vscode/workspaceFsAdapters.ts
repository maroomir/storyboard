import type { StoryUri, SceneContextWorkspaceFileSystem } from '@storyboard/story-model';
import * as vscode from 'vscode';

import { writeFileAtomically } from './atomicWrite';

export const vscodeFsAdapter = {
  readFile: (uri: StoryUri): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: StoryUri, content: Uint8Array): PromiseLike<void> =>
    writeFileAtomically(uri, content),
};

export const draftHistoryFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  createDirectory: (uri: StoryUri): PromiseLike<void> =>
    vscode.workspace.fs.createDirectory(uri as vscode.Uri),
  exists: async (uri: StoryUri): Promise<boolean> => {
    try {
      await vscode.workspace.fs.stat(uri as vscode.Uri);
      return true;
    } catch {
      return false;
    }
  },
  listFileNames: async (uri: StoryUri): Promise<string[]> => {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
  },
};

export const sceneContextFileSystem: SceneContextWorkspaceFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  readDirectory: async (uri: StoryUri): Promise<[string, { type: 'file' | 'directory' }][]> => {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.map(([name, fileType]) => [
      name,
      { type: fileType === vscode.FileType.Directory ? ('directory' as const) : ('file' as const) },
    ]);
  },
};
