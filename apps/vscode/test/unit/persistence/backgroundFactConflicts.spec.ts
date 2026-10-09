import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import { createBackgroundFactConflictStore } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  readBackgroundFactConflictResponse,
  type BackgroundCard,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '@storyboard/story-engine';

class MemoryWorkspace implements IFileSystem {
  private readonly files = new Map<string, string>();

  public async readFile(uri: { path: string }): Promise<Uint8Array> {
    const content = this.files.get(uri.path);

    if (content === undefined) {
      throw new Error(`ENOENT: ${uri.path}`);
    }

    return new TextEncoder().encode(content);
  }

  public async writeFile(uri: { path: string }, content: Uint8Array): Promise<void> {
    this.files.set(uri.path, new TextDecoder().decode(content));
  }

  public async createDirectory(): Promise<void> {}

  public async exists(uri: { path: string }): Promise<boolean> {
    return this.files.has(uri.path);
  }

  public async listFileNames(): Promise<string[]> {
    return [];
  }

  public async readDirectory(): Promise<FileSystemDirectoryEntry[]> {
    return [];
  }

  public async delete(uri: { path: string }): Promise<void> {
    this.files.delete(uri.path);
  }

  public async modifiedTime(): Promise<number> {
    return 0;
  }

  public async isRealPathInside(): Promise<boolean> {
    return true;
  }
}

const sofa = '손님은 거실 소파에서 잔다';
const room = '손님에게 자기 방이 있다';
const condo: BackgroundCard = {
  type: 'location',
  id: 'condo',
  name: '해외 콘도',
  locationKind: 'place',
  description: [sofa, room, '거실 통창 너머 바다'],
  characterIds: [],
  tags: [],
};

describe('background fact conflict response', () => {
  const lines = [sofa, room, '거실 통창 너머 바다'];

  it('keeps a pair only when both lines are the card lines word for word', () => {
    const conflicts = readBackgroundFactConflictResponse(
      {
        conflicts: [
          { items: [sofa, room] },
          { items: [room, sofa] },
          { items: [sofa, '손님은 소파에서 잔다'] },
          { items: [sofa] },
        ],
      },
      lines,
    );

    expect(conflicts).toEqual([{ items: [sofa, room] }]);
  });

  it('reads an answer it cannot parse as no conflict', () => {
    expect(readBackgroundFactConflictResponse(null, lines)).toEqual([]);
    expect(readBackgroundFactConflictResponse({ conflicts: 'none' }, lines)).toEqual([]);
  });
});

describe('background fact conflict store', () => {
  const paths = getStoryboardProjectPaths(vscode.Uri.file('/workspace'));
  let fileSystem: MemoryWorkspace;

  beforeEach(() => {
    fileSystem = new MemoryWorkspace();
  });

  it('has no answer for a card it never checked', async () => {
    expect(await createBackgroundFactConflictStore(fileSystem, paths).load(condo)).toBeUndefined();
  });

  it('returns the saved answer while the card lines stay the same', async () => {
    const store = createBackgroundFactConflictStore(fileSystem, paths);
    await store.save(condo, [{ items: [sofa, room] }]);

    expect(await store.load({ ...condo, tags: ['새 태그'] })).toEqual([{ items: [sofa, room] }]);
    expect(await store.load({ ...condo, description: [sofa, '거실 통창 너머 바다'] })).toBeUndefined();
  });

  it('keeps one record per card in the shared cache file', async () => {
    const store = createBackgroundFactConflictStore(fileSystem, paths);
    const office: BackgroundCard = { ...condo, id: 'office', name: '사무실' };
    await store.save(condo, [{ items: [sofa, room] }]);
    await store.save(office, []);

    expect(await store.load(condo)).toEqual([{ items: [sofa, room] }]);
    expect(await store.load(office)).toEqual([]);
  });
});
