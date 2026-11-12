import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  RenameSceneUseCase,
  WorkspaceScenes,
  type IStoryboardLogger,
} from '@storyboard/story-engine';
import { createDraft, NodeUri, parseDraft, serializeDraft } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHost } from '@storyboard/story-engine/testing';
import type { WorkspaceCaches } from '@storyboard/story-engine';

import { createWorkspaceCaches, createWorkspaceCards } from './fixtures/workspaceCacheFixture';
import { readSceneFromBundles, writeSceneBundlesFromYaml } from './fixtures/sceneBundles';

const fromStem = '003-night-market';
const silentLogger: IStoryboardLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  show: (): void => {},
};

let workspace: string;
let caches: WorkspaceCaches;

function write(relativePath: string, content: string): void {
  const target = join(workspace, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function read(relativePath: string): string {
  return readFileSync(join(workspace, relativePath), 'utf8');
}

function has(relativePath: string): boolean {
  return existsSync(join(workspace, relativePath));
}

function rename(
  toStem: string,
  fileSystem: NodeFileSystem = new NodeFileSystem(),
): ReturnType<RenameSceneUseCase['execute']> {
  const scenes: WorkspaceScenes = new WorkspaceScenes({
    fileSystem,
    caches,
    cards: createWorkspaceCards(caches),
  });
  return new RenameSceneUseCase(
    createTestHost({ fileSystem, logger: silentLogger, caches, scenes }),
  ).execute({
    workspaceRoot: NodeUri.file(workspace),
    fromStem,
    toStem,
  });
}

class FailingFileSystem extends NodeFileSystem {
  private writesLeft: number;

  public constructor(writesBeforeFailure: number) {
    super();
    this.writesLeft = writesBeforeFailure;
  }

  public override async writeFile(...args: Parameters<NodeFileSystem['writeFile']>): Promise<void> {
    if (this.writesLeft-- === 0) {
      throw new Error('disk full');
    }

    await super.writeFile(...args);
  }
}

function draftFor(stem: string, body: string): string {
  return serializeDraft(
    createDraft({
      sceneStem: stem,
      format: 'novel',
      body,
      generatedAt: '2026-10-01T00:00:00.000Z',
    }),
  );
}

beforeEach(async () => {
  caches = createWorkspaceCaches();
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-rename-'));

  await writeSceneBundlesFromYaml(workspace, [
    'type: scene\nid: 001-opening\n',
    'type: scene\nid: 002-walk\n',
    `type: scene\nid: ${fromStem}\ntitle: 야시장\nsummary: 야시장에서 둘이 마주친다.\nbeats:\n  - 등불이 켜진다.\n`,
    'type: scene\nid: 004-dawn\n',
  ]);
  write(`draft/${fromStem}.md`, draftFor(fromStem, '등불 아래.\n'));
  write(`scene/${fromStem}.card/dialogue.json`, `${JSON.stringify({ sceneStem: fromStem, turns: [] })}\n`);
  write(`scene/${fromStem}.card/state.yaml`, 'statements:\n  - {facet: event, value: 야시장은 자정에 닫는다.}\n');
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('RenameSceneUseCase', () => {
  it('moves the bundle and every file named after the scene', async () => {
    const result = await rename('003-moon-market');

    expect(result).toMatchObject({ ok: true, kind: 'renamed', toStem: '003-moon-market' });
    expect(has(`scene/${fromStem}.card`)).toBe(false);
    expect(has('scene/003-moon-market.card/card.yaml')).toBe(true);
    const moved = await readSceneFromBundles(workspace, '003-moon-market');
    expect(moved).toMatchObject({ slug: 'moon-market', order: 3 });
    expect(moved?.card.title).toBe('야시장');
    expect(moved?.summaryText).toBe('야시장에서 둘이 마주친다.\n');
    expect(parseDraft(read('draft/003-moon-market.md'))).toMatchObject({
      sceneStem: '003-moon-market',
      body: '등불 아래.\n',
    });
    expect(has(`draft/${fromStem}.md`)).toBe(false);
    expect(read('scene/003-moon-market.card/dialogue.json')).toContain('turns');
  });

  it('carries the scene state along with the bundle', async () => {
    const before = read(`scene/${fromStem}.card/state.yaml`);

    await rename('003-moon-market');

    expect(read('scene/003-moon-market.card/state.yaml')).toBe(before);
  });

  it('refuses a number change and leaves the workspace untouched', async () => {
    const result = await rename('004-night-market');

    expect(result).toMatchObject({ ok: false, kind: 'order-changed' });
    expect((result as { message: string }).message).toContain('scene move');
    expect(has(`scene/${fromStem}.card`)).toBe(true);
    expect(has(`draft/${fromStem}.md`)).toBe(true);
  });

  it('finishes a rename that was cut off by running it again', async () => {
    expect(await rename('003-moon-market', new FailingFileSystem(2))).toMatchObject({ ok: false });
    expect(has(`scene/${fromStem}.card`)).toBe(true);

    expect(await rename('003-moon-market')).toMatchObject({ ok: true, kind: 'renamed' });
    expect(has(`scene/${fromStem}.card`)).toBe(false);
    expect(has(`draft/${fromStem}.md`)).toBe(false);
    expect(parseDraft(read('draft/003-moon-market.md')).sceneStem).toBe('003-moon-market');
  });

  it('refuses a malformed stem and a missing scene', async () => {
    expect(await rename('night-market')).toMatchObject({ ok: false, kind: 'invalid-stem' });
    expect(await rename(fromStem)).toMatchObject({ ok: false, kind: 'invalid-stem' });

    rmSync(join(workspace, 'scene', `${fromStem}.card`), { recursive: true });
    expect(await rename('003-moon-market')).toMatchObject({ ok: false, kind: 'missing' });
  });
});
