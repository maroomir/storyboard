import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VscodeFileSystem } from '@/infrastructure/vscode/vscode-file-system';
import { FileType, workspace } from '../../stubs/vscode';

const workspaceFileSystem = workspace.fs as Record<string, unknown>;

describe('VscodeFileSystem', () => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('adapts VS Code file operations to the application port', async () => {
    const uri = vscode.Uri.file('/workspace/file.txt');
    const bytes = new Uint8Array([1, 2, 3]);
    const readFile = vi.fn(async (): Promise<Uint8Array> => bytes);
    const writeFile = vi.fn(async (): Promise<void> => undefined);
    const createDirectory = vi.fn(async (): Promise<void> => undefined);
    const stat = vi.fn(async (): Promise<{ type: FileType }> => ({ type: FileType.File }));
    const readDirectory = vi.fn(
      async (): Promise<[string, FileType][]> => [
        ['one.txt', FileType.File],
        ['nested', FileType.Directory],
      ],
    );

    workspaceFileSystem.readFile = readFile;
    workspaceFileSystem.writeFile = writeFile;
    workspaceFileSystem.createDirectory = createDirectory;
    workspaceFileSystem.stat = stat;
    workspaceFileSystem.readDirectory = readDirectory;

    const fileSystem = new VscodeFileSystem();

    await expect(fileSystem.readFile(uri)).resolves.toEqual(bytes);
    await fileSystem.writeFile(uri, bytes);
    await fileSystem.createDirectory(uri);
    await expect(fileSystem.exists(uri)).resolves.toBe(true);
    await expect(fileSystem.listFileNames(uri)).resolves.toEqual(['one.txt']);
    await expect(fileSystem.readDirectory(uri)).resolves.toEqual([
      ['one.txt', { type: 'file' }],
      ['nested', { type: 'directory' }],
    ]);

    expect(writeFile).toHaveBeenCalledWith(uri, bytes);
    expect(createDirectory).toHaveBeenCalledWith(uri);
  });

  it('returns false when VS Code cannot stat a resource', async () => {
    workspaceFileSystem.stat = async (): Promise<never> => {
      throw new Error('not found');
    };

    await expect(new VscodeFileSystem().exists(vscode.Uri.file('/missing'))).resolves.toBe(false);
  });
});
