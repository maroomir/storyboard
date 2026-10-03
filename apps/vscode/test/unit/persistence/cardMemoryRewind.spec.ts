import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
  getStoryboardProjectPaths,
} from '@storyboard/story-engine';
import type { FileSystemDirectoryEntry, IFileSystem } from '@storyboard/story-engine';
import {
  computeBackgroundCardHash,
  computePersonaCardHash,
  type BackgroundCard,
  type CharacterCard,
} from '@storyboard/story-model';

class MemoryWorkspace implements IFileSystem {
  private readonly files = new Map<string, string>();

  public write(path: string, content: string): void {
    this.files.set(path, content);
  }

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

const paths = getStoryboardProjectPaths(vscode.Uri.file('/workspace'));

const character = {
  type: 'character',
  id: 'elia',
  name: '엘리아',
  attributes: {},
} as unknown as CharacterCard;

const background = {
  type: 'background',
  id: 'school',
  name: '학교',
  attributes: {},
} as unknown as BackgroundCard;

describe('card memory rewind', () => {
  let fileSystem: MemoryWorkspace;

  const writePersona = (updatedThroughScene: string): void => {
    fileSystem.write(
      `${paths.personaMemoryDirectory.path}/elia.json`,
      JSON.stringify({
        cardId: 'elia',
        persona: '저장된 페르소나',
        updatedThroughScene,
        cardHash: computePersonaCardHash(character),
      }),
    );
  };

  const writeBackground = (updatedThroughScene: string): void => {
    fileSystem.write(
      `${paths.backgroundMemoryDirectory.path}/school.json`,
      JSON.stringify({
        cardId: 'school',
        atmosphere: '저장된 분위기',
        updatedThroughScene,
        cardHash: computeBackgroundCardHash(background),
      }),
    );
  };

  beforeEach(() => {
    fileSystem = new MemoryWorkspace();
  });

  it('reuses a persona that stopped before the scene being written', async () => {
    writePersona('04-fourth');

    const store = createPersonaMemoryStore(fileSystem, paths, '05-fifth');

    expect(await store.load(character)).toBe('저장된 페르소나');
  });

  it('drops a persona that already ran past the scene being rewritten', async () => {
    writePersona('30-final');

    const store = createPersonaMemoryStore(fileSystem, paths, '05-fifth');

    expect(await store.load(character)).toBeUndefined();
  });

  it('drops a persona saved by the very scene being generated again', async () => {
    writePersona('05-fifth');

    const store = createPersonaMemoryStore(fileSystem, paths, '05-fifth');

    expect(await store.load(character)).toBeUndefined();
  });

  it('keeps a persona whose scene name carries no order to compare', async () => {
    writePersona('legacy-memory');

    const store = createPersonaMemoryStore(fileSystem, paths, '05-fifth');

    expect(await store.load(character)).toBe('저장된 페르소나');
  });

  it('rewinds background atmosphere on the same rule', async () => {
    writeBackground('30-final');

    const ahead = createBackgroundMemoryStore(fileSystem, paths, '05-fifth');
    expect(await ahead.load(background)).toBeUndefined();

    writeBackground('02-second');
    const behind = createBackgroundMemoryStore(fileSystem, paths, '05-fifth');
    expect(await behind.load(background)).toBe('저장된 분위기');
  });
});
