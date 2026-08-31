import * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
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

    const rename = vi.fn(async (): Promise<void> => undefined);

    workspaceFileSystem.readFile = readFile;
    workspaceFileSystem.writeFile = writeFile;
    workspaceFileSystem.rename = rename;
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

    // 쓰기는 임시 파일 → 바꿔치기 순서라, 중간에 죽어도 잘린 파일이 목적지에 남지 않는다.
    const writtenUri = writeFile.mock.calls[0]?.[0] as { path: string };
    expect(writtenUri.path).toMatch(/^\/workspace\/file\.txt\.tmp-/);
    expect(writeFile.mock.calls[0]?.[1]).toBe(bytes);
    expect(rename).toHaveBeenCalledWith(writtenUri, uri, { overwrite: true });
    expect(createDirectory).toHaveBeenCalledWith(uri);
  });

  it('removes the temporary file and rethrows when the atomic swap fails', async () => {
    const uri = vscode.Uri.file('/workspace/file.txt');
    const remove = vi.fn(async (): Promise<void> => undefined);
    workspaceFileSystem.writeFile = vi.fn(async (): Promise<void> => undefined);
    workspaceFileSystem.rename = vi.fn(async (): Promise<never> => {
      throw new Error('rename failed');
    });
    workspaceFileSystem.delete = remove;

    await expect(new VscodeFileSystem().writeFile(uri, new Uint8Array([1]))).rejects.toThrow(
      'rename failed',
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('returns false when VS Code cannot stat a resource', async () => {
    workspaceFileSystem.stat = async (): Promise<never> => {
      throw new Error('not found');
    };

    await expect(new VscodeFileSystem().exists(vscode.Uri.file('/missing'))).resolves.toBe(false);
  });
});
