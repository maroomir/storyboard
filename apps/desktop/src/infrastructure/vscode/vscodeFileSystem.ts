import * as vscode from 'vscode';

import type { FileSystemDirectoryEntry, IFileSystem } from '@storyboard/story-engine';
import { writeFileAtomically } from './atomicWrite';

export class VscodeFileSystem implements IFileSystem {
  public async readFile(uri: unknown): Promise<Uint8Array> {
    return await vscode.workspace.fs.readFile(uri as vscode.Uri);
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    await writeFileAtomically(uri, content);
  }

  public async createDirectory(uri: unknown): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri as vscode.Uri);
  }

  public async exists(uri: unknown): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri as vscode.Uri);
      return true;
    } catch {
      return false;
    }
  }

  public async listFileNames(uri: unknown): Promise<readonly string[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
  }

  public async readDirectory(uri: unknown): Promise<FileSystemDirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri);
    return entries.map(([name, type]) => [
      name,
      { type: type === vscode.FileType.Directory ? ('directory' as const) : ('file' as const) },
    ]);
  }
}
