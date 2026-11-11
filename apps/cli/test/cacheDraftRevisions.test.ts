import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DraftRevisionStore, keptDraftRevisionCount } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const rooftop = 'c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b';

afterEach(() => workspaces.cleanUp());

function openStore(workspace: string): DraftRevisionStore {
  return new DraftRevisionStore({
    fileSystem: new NodeFileSystem(),
    workspaceRoot: NodeUri.file(workspace),
    now: () => new Date(2026, 10, 11, 9, 30),
  });
}

describe('draft revisions', () => {
  it('keeps the draft about to be overwritten under the scene uuid, whatever its number', async () => {
    const workspace: string = workspaces.create();
    mkdirSync(join(workspace, 'draft'));
    writeFileSync(join(workspace, 'draft/002-rooftop.md'), '옥상 첫 판');
    const store: DraftRevisionStore = openStore(workspace);

    const kept: string | undefined = await store.keepBeforeOverwrite(rooftop, 'draft/002-rooftop.md');

    expect(kept).toBe('2026-11-11-09-30-rev-01.md');
    expect(readFileSync(join(workspace, '.storyboard/cache/revisions', rooftop, kept ?? ''), 'utf8')).toBe('옥상 첫 판');
    expect(await store.keepBeforeOverwrite(rooftop, 'draft/003-rooftop.md')).toBeUndefined();
  });

  it('keeps only the last ten revisions of a scene', async () => {
    const workspace: string = workspaces.create();
    mkdirSync(join(workspace, 'draft'));
    const store: DraftRevisionStore = openStore(workspace);
    for (let round: number = 1; round <= keptDraftRevisionCount + 2; round += 1) {
      writeFileSync(join(workspace, 'draft/002-rooftop.md'), `판 ${round}`);
      await store.keepBeforeOverwrite(rooftop, 'draft/002-rooftop.md');
    }

    const revisions: readonly string[] = await store.list(rooftop);

    expect(revisions).toHaveLength(keptDraftRevisionCount);
    expect(revisions[0]).toBe('2026-11-11-09-30-rev-03.md');
    expect(revisions.at(-1)).toBe('2026-11-11-09-30-rev-12.md');
  });

  it('clears the revisions and the intermediate outputs of a removed scene', async () => {
    const workspace: string = workspaces.create();
    mkdirSync(join(workspace, 'draft'));
    writeFileSync(join(workspace, 'draft/002-rooftop.md'), '옥상');
    const store: DraftRevisionStore = openStore(workspace);
    await store.keepBeforeOverwrite(rooftop, 'draft/002-rooftop.md');
    mkdirSync(join(workspace, '.storyboard/cache/scenes', rooftop), { recursive: true });

    await store.removeAll(rooftop);
    await store.clearSceneCache(rooftop);

    expect(await store.list(rooftop)).toEqual([]);
    expect(existsSync(join(workspace, '.storyboard/cache/scenes', rooftop))).toBe(false);
  });
});
