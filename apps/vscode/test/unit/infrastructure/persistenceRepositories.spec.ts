import { describe, expect, it } from 'vitest';

import type { IFileSystem } from '@storyboard/story-engine';
import { DraftRepository } from '@storyboard/story-engine';
import { ProjectRepository } from '@storyboard/story-engine';
import { SceneCacheRepository } from '@storyboard/story-engine';
import { NodeUri, createDraft, parseDraft, parseSceneCache } from '@storyboard/story-model';

class InMemoryFileSystem implements IFileSystem {
  public readonly directories: unknown[] = [];
  private readonly files = new Map<unknown, Uint8Array>();

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const content = this.files.get(String(uri));

    if (!content) {
      throw new Error('File not found');
    }

    return content;
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    this.files.set(String(uri), content);
  }

  public async createDirectory(uri: unknown): Promise<void> {
    this.directories.push(uri);
  }

  public async exists(uri: unknown): Promise<boolean> {
    return this.files.has(String(uri));
  }

  public async listFileNames(): Promise<readonly string[]> {
    return [];
  }

  public async readDirectory(): Promise<[string, { type: 'file' | 'directory' }][]> {
    return [];
  }
}

describe('persistence repositories', () => {
  it('reads a project through the injected file system', async () => {
    const fileSystem = new InMemoryFileSystem();
    const uri = NodeUri.file('/ws/.storyboard/project.json');
    await fileSystem.writeFile(
      uri,
      new TextEncoder().encode(
        JSON.stringify({
          version: '2.0.0',
          id: 'project-id',
          name: 'Project',
          format: 'novel',
          language: 'ko',
          createdAt: '2026-01-01T00:00:00.000Z',
          editor: {},
        }),
      ),
    );

    await expect(new ProjectRepository(fileSystem).read(uri)).resolves.toMatchObject({
      id: 'project-id',
      name: 'Project',
    });
  });

  it('writes serialized drafts through the draft repository', async () => {
    const fileSystem = new InMemoryFileSystem();
    const draftUri = 'draft';

    await new DraftRepository(fileSystem).write(
      draftUri,
      createDraft({ sceneStem: '01-opening', format: 'novel', body: 'Draft body' }),
    );

    expect(parseDraft(new TextDecoder().decode(await fileSystem.readFile(draftUri))).body).toBe(
      'Draft body\n',
    );
  });

  it('persists canonical scene cache data and creates its directory', async () => {
    const fileSystem = new InMemoryFileSystem();
    const cacheRepository = new SceneCacheRepository(fileSystem);
    const cacheUri = 'cache';

    await cacheRepository.ensureDirectory('cache-directory');
    await cacheRepository.write(cacheUri, {
      sceneStem: '01-opening',
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputHash: `sha256:${'0'.repeat(64)}`,
      input: 'Scene body',
      detectedCharacters: [],
      personasUsed: {},
      providers: {},
    });

    await expect(cacheRepository.read(cacheUri)).resolves.toEqual(
      parseSceneCache(new TextDecoder().decode(await fileSystem.readFile(cacheUri))),
    );
    expect(fileSystem.directories).toEqual(['cache-directory']);
  });
});
