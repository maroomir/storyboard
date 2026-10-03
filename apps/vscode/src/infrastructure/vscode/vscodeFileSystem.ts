import { promises as fs } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import type { StoryUri } from '@storyboard/story-model';
import * as vscode from 'vscode';

import type { FileSystemDirectoryEntry, IFileSystem } from '@storyboard/story-engine';
import { writeFileAtomically } from './atomicWrite';

export class VscodeFileSystem implements IFileSystem {
  public async readFile(uri: StoryUri): Promise<Uint8Array> {
    return await vscode.workspace.fs.readFile(uri as vscode.Uri);
  }

  public async writeFile(uri: StoryUri, content: Uint8Array): Promise<void> {
    await writeFileAtomically(uri, content);
  }

  public async createDirectory(uri: StoryUri): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri as vscode.Uri);
  }

  public async exists(uri: StoryUri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri as vscode.Uri);
      return true;
    } catch {
      return false;
    }
  }

  public async listFileNames(uri: StoryUri): Promise<readonly string[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
  }

  public async readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.map(([name, type]) => [
      name,
      { type: type === vscode.FileType.Directory ? ('directory' as const) : ('file' as const) },
    ]);
  }

  public async delete(uri: StoryUri): Promise<void> {
    await vscode.workspace.fs.delete(uri as vscode.Uri);
  }

  public async modifiedTime(uri: StoryUri): Promise<number> {
    try {
      return (await vscode.workspace.fs.stat(uri as vscode.Uri)).mtime;
    } catch {
      return 0;
    }
  }

  public async isRealPathInside(uri: StoryUri, root: StoryUri): Promise<boolean> {
    const [realTarget, realRoot] = await Promise.all([
      fs.realpath(uri.fsPath),
      fs.realpath(root.fsPath),
    ]);
    const fromRoot = relative(realRoot, realTarget);

    return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  }
}

// The extension has exactly one file system, the same way it has exactly one `vscode.workspace.fs`.
// Presentation code reaches for this instance; the engine never does — it is always injected.
export const vscodeFileSystem = new VscodeFileSystem();
