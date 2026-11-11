import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  CreateSceneUseCase,
  JournalStore,
  MoveSceneUseCase,
  RemoveSceneUseCase,
  SceneRenumberer,
  WorkspaceScenes,
  type IStoryboardLogger,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import { createTestHost } from '@storyboard/story-engine/testing';
import {
  createDraft,
  NodeUri,
  parseChapterOutline,
  parseDraft,
  serializeChapterOutline,
  serializeDraft,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceCaches, createWorkspaceCards } from './fixtures/workspaceCacheFixture';
import { listSceneStems, writeSceneBundlesFromYaml } from './fixtures/sceneBundles';

const silentLogger: IStoryboardLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  show: (): void => {},
};

let workspace: string;
let caches: WorkspaceCaches;

class FailingFileSystem extends NodeFileSystem {
  private deletesLeft: number;

  public constructor(deletesBeforeFailure: number) {
    super();
    this.deletesLeft = deletesBeforeFailure;
  }

  public override async delete(...args: Parameters<NodeFileSystem['delete']>): Promise<void> {
    if (this.deletesLeft-- === 0) {
      throw new Error('disk gone');
    }

    await super.delete(...args);
  }
}

function hostOf(fileSystem: NodeFileSystem = new NodeFileSystem()): ReturnType<typeof createTestHost> {
  const cards = createWorkspaceCards(caches);
  const scenes: WorkspaceScenes = new WorkspaceScenes({ fileSystem, caches, cards });
  return createTestHost({ fileSystem, logger: silentLogger, caches, scenes, cards });
}

function root(): NodeUri {
  return NodeUri.file(workspace);
}

function write(relativePath: string, content: string): void {
  const target: string = join(workspace, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function read(relativePath: string): string {
  return readFileSync(join(workspace, relativePath), 'utf8');
}

function draftFor(stem: string, body: string): string {
  return serializeDraft(
    createDraft({ sceneStem: stem, format: 'novel', body, generatedAt: '2026-11-01T00:00:00.000Z' }),
  );
}

async function sceneIdOf(reference: string): Promise<string> {
  const id: string | undefined = (await hostOf().scenes.find(root(), reference))?.content.header.id;
  if (id === undefined) {
    throw new Error(`씬이 없습니다: ${reference}`);
  }
  return id;
}

async function writeChapters(chapters: readonly (readonly string[])[]): Promise<void> {
  const scenes: string[][] = [];
  for (const references of chapters) {
    const ids: string[] = [];
    for (const reference of references) {
      ids.push(await sceneIdOf(reference));
    }
    scenes.push(ids);
  }
  write(
    STORYBOARD_RELATIVE_PATHS.outlineChapters,
    serializeChapterOutline({
      version: '1.0.0',
      acts: [
        {
          id: 'act-1',
          title: '1막',
          chapters: scenes.map((ids, index) => ({
            id: `chapter-${index + 1}`,
            title: `${index + 1}장`,
            scenes: ids,
          })),
        },
      ],
    }),
  );
}

function chapterScenes(): string[][] {
  return parseChapterOutline(read(STORYBOARD_RELATIVE_PATHS.outlineChapters)).acts[0]!.chapters.map(
    (chapter) => [...chapter.scenes],
  );
}

beforeEach(async () => {
  caches = createWorkspaceCaches();
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-sequence-'));

  await writeSceneBundlesFromYaml(workspace, [
    'type: scene\nid: 001-opening\n',
    'type: scene\nid: 002-walk\n',
    'type: scene\nid: 003-market\n',
  ]);
  write('draft/001-opening.md', draftFor('001-opening', '시작.\n'));
  write('draft/003-market.md', draftFor('003-market', '시장.\n'));
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('MoveSceneUseCase', () => {
  it('renumbers the bundles and drafts in the new order', async () => {
    const result = await new MoveSceneUseCase(hostOf()).execute({
      workspaceRoot: root(),
      scene: 'market',
    });

    expect(result).toMatchObject({ ok: true, kind: 'moved', stem: '001-market' });
    expect(listSceneStems(workspace)).toEqual(['001-market', '002-opening', '003-walk']);
    expect(parseDraft(read('draft/001-market.md'))).toMatchObject({
      sceneStem: '001-market',
      body: '시장.\n',
    });
    expect(parseDraft(read('draft/002-opening.md')).sceneStem).toBe('002-opening');
    expect(existsSync(join(workspace, 'draft/003-market.md'))).toBe(false);
  });

  it('places a scene right after another by number', async () => {
    const result = await new MoveSceneUseCase(hostOf()).execute({
      workspaceRoot: root(),
      scene: '001',
      after: 'walk',
    });

    expect(result).toMatchObject({ ok: true, stem: '002-opening' });
    expect(listSceneStems(workspace)).toEqual(['001-walk', '002-opening', '003-market']);
  });

  it('moves the scene into the chapter of the scene it follows', async () => {
    await writeChapters([['opening', 'walk'], ['market']]);
    const marketId: string = await sceneIdOf('market');

    await new MoveSceneUseCase(hostOf()).execute({
      workspaceRoot: root(),
      scene: 'market',
      after: 'opening',
    });

    expect(chapterScenes()[0]).toEqual([await sceneIdOf('opening'), marketId, await sceneIdOf('walk')]);
    expect(chapterScenes()[1]).toEqual([]);
  });

  it('refuses a missing scene and a move after itself', async () => {
    const move = new MoveSceneUseCase(hostOf());

    expect(await move.execute({ workspaceRoot: root(), scene: 'nowhere' })).toMatchObject({
      ok: false,
      kind: 'missing',
    });
    expect(
      await move.execute({ workspaceRoot: root(), scene: 'walk', after: 'nowhere' }),
    ).toMatchObject({ ok: false, kind: 'missing', message: '씬이 없습니다: nowhere' });
    expect(
      await move.execute({ workspaceRoot: root(), scene: 'walk', after: '002' }),
    ).toMatchObject({ ok: false, kind: 'same-scene' });
  });

  it('finishes a renumbering that was cut off from its journal', async () => {
    const result = await new MoveSceneUseCase(hostOf(new FailingFileSystem(2))).execute({
      workspaceRoot: root(),
      scene: 'market',
    });
    expect(result).toMatchObject({ ok: false });
    expect(new JournalStore(await caches.open(root())).findUnfinishedSceneRename()).toBeDefined();

    expect(await new SceneRenumberer(hostOf()).resume(root())).toBe(true);

    expect(listSceneStems(workspace)).toEqual(['001-market', '002-opening', '003-walk']);
    expect(parseDraft(read('draft/001-market.md')).sceneStem).toBe('001-market');
    expect(new JournalStore(await caches.open(root())).findUnfinishedSceneRename()).toBeUndefined();
  });
});

describe('RemoveSceneUseCase', () => {
  it('deletes the scene with its draft and closes the gap', async () => {
    await writeChapters([['opening', 'walk', 'market']]);
    const walkId: string = await sceneIdOf('walk');
    write(`.storyboard/cache/revisions/${walkId}/002-walk-rev-01.md`, '옛 판본\n');

    const result = await new RemoveSceneUseCase(hostOf()).execute({
      workspaceRoot: root(),
      scene: '002-walk',
    });

    expect(result).toMatchObject({ ok: true, kind: 'removed', stem: '002-walk' });
    expect(listSceneStems(workspace)).toEqual(['001-opening', '002-market']);
    expect(parseDraft(read('draft/002-market.md')).sceneStem).toBe('002-market');
    expect(existsSync(join(workspace, `.storyboard/cache/revisions/${walkId}`))).toBe(false);
    expect(chapterScenes()[0]).not.toContain(walkId);
  });

  it('carries the stem-keyed caches of the scenes behind to their new numbers', async () => {
    write('.storyboard/cache/scenes/002-walk.json', '{"sceneStem":"002-walk","inputHash":"walk"}\n');
    write('.storyboard/cache/scenes/003-market.json', '{"sceneStem":"003-market","inputHash":"market"}\n');
    write('.storyboard/cache/revisions/003-market.json', '{"sceneStem":"003-market","rounds":[]}\n');

    await new RemoveSceneUseCase(hostOf()).execute({ workspaceRoot: root(), scene: '002-walk' });

    expect(JSON.parse(read('.storyboard/cache/scenes/002-market.json'))).toEqual({
      sceneStem: '002-market',
      inputHash: 'market',
    });
    expect(JSON.parse(read('.storyboard/cache/revisions/002-market.json')).sceneStem).toBe('002-market');
    expect(existsSync(join(workspace, '.storyboard/cache/scenes/003-market.json'))).toBe(false);
  });

  it('refuses a scene that does not exist', async () => {
    expect(
      await new RemoveSceneUseCase(hostOf()).execute({ workspaceRoot: root(), scene: '9' }),
    ).toMatchObject({ ok: false, kind: 'missing' });
  });
});

describe('CreateSceneUseCase', () => {
  it('inserts a new scene after another and renumbers the rest', async () => {
    const result = await new CreateSceneUseCase(hostOf()).execute({
      workspaceRoot: root(),
      slug: 'rain',
      after: 'opening',
    });

    expect(result).toMatchObject({ ok: true, kind: 'created', stem: '002-rain' });
    expect(listSceneStems(workspace)).toEqual([
      '001-opening',
      '002-rain',
      '003-walk',
      '004-market',
    ]);
    expect(parseDraft(read('draft/004-market.md')).sceneStem).toBe('004-market');
  });

  it('refuses to insert after a scene that does not exist', async () => {
    expect(
      await new CreateSceneUseCase(hostOf()).execute({
        workspaceRoot: root(),
        slug: 'rain',
        after: 'nowhere',
      }),
    ).toMatchObject({ ok: false, kind: 'missing' });
    expect(listSceneStems(workspace)).toHaveLength(3);
  });
});
