import { describe, expect, it } from 'vitest';

import type { IFileSystem } from '@/application/ports/fileSystem';
import { DraftRepository } from '@/infrastructure/persistence/repositories/draftRepository';
import { ProjectRepository } from '@/infrastructure/persistence/repositories/projectRepository';
import { SceneCacheRepository } from '@/infrastructure/persistence/repositories/sceneCacheRepository';
import { SceneRepository } from '@/infrastructure/persistence/repositories/sceneRepository';
import { createDraft, parseDraft } from '@storyboard/story-format';
import { parseSceneCache } from '@/domain/files/sceneCache';

class InMemoryFileSystem implements IFileSystem {
  public readonly directories: unknown[] = [];
  private readonly files = new Map<unknown, Uint8Array>();

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const content = this.files.get(uri);

    if (!content) {
      throw new Error('File not found');
    }

    return content;
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    this.files.set(uri, content);
  }

  public async createDirectory(uri: unknown): Promise<void> {
    this.directories.push(uri);
  }

  public async exists(uri: unknown): Promise<boolean> {
    return this.files.has(uri);
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
    const uri = 'project';
    await fileSystem.writeFile(
      uri,
      new TextEncoder().encode(
        JSON.stringify({
          version: '1.0.0',
          id: 'project-id',
          name: 'Project',
          format: 'novel',
          language: 'ko',
          createdAt: '2026-01-01T00:00:00.000Z',
          editor: { scenePrefixDigits: 2 },
        }),
      ),
    );

    await expect(new ProjectRepository(fileSystem).read(uri)).resolves.toMatchObject({
      id: 'project-id',
      name: 'Project',
    });
  });

  it('reads scenes and writes serialized drafts through repositories', async () => {
    const fileSystem = new InMemoryFileSystem();
    const sceneUri = 'scene';
    const draftUri = 'draft';
    await fileSystem.writeFile(
      sceneUri,
      new TextEncoder().encode('type: scene\nid: 01-opening\nsummary: Scene body\n'),
    );

    await expect(new SceneRepository(fileSystem).read(sceneUri, '01-opening.card')).resolves.toMatchObject({
      stem: '01-opening',
      body: 'Scene body\n',
    });

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
      extractedSituations: [],
      personasUsed: {},
      providers: {},
    });

    await expect(cacheRepository.read(cacheUri)).resolves.toEqual(
      parseSceneCache(new TextDecoder().decode(await fileSystem.readFile(cacheUri))),
    );
    expect(fileSystem.directories).toEqual(['cache-directory']);
  });
});
