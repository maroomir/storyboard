import { afterEach, describe, expect, it } from 'vitest';

import { ElementIndexStore, JournalStore, type IndexedElement } from '@storyboard/story-engine';
import { planSceneRenames, type StoryStructure } from '@storyboard/story-model';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const elia = '3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44';
const arrival = '9d41b2c3-4d5e-4f6a-8b7c-1d2e3f4a5b6c';
const rooftop = 'c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b';

afterEach(() => workspaces.cleanUp());

describe('element index', () => {
  it('finds an element by path and by uuid, and lists one kind', async () => {
    const index: ElementIndexStore = new ElementIndexStore(await workspaces.openFreshCache());
    const eliaRow: IndexedElement = { id: elia, kind: 'character', slug: 'elia', path: 'character/elia.card', cardHash: 'sha256:aa' };
    const sceneRow: IndexedElement = { id: rooftop, kind: 'scene', slug: 'rooftop', path: 'scene/002-rooftop.card', cardHash: 'sha256:bb' };
    index.upsert(eliaRow);
    index.upsert(sceneRow);

    expect(index.findByPath('character/elia.card')).toEqual(eliaRow);
    expect(index.findById(rooftop)).toEqual([sceneRow]);
    expect(index.list('scene')).toEqual([sceneRow]);
  });

  it('keeps both folders of a copied uuid and rebuilds from scratch', async () => {
    const index: ElementIndexStore = new ElementIndexStore(await workspaces.openFreshCache());
    index.upsert({ id: elia, kind: 'character', slug: 'elia', path: 'character/elia.card', cardHash: 'sha256:aa' });
    index.upsert({ id: elia, kind: 'character', slug: 'elia-copy', path: 'character/elia-copy.card', cardHash: 'sha256:aa' });

    expect(index.findById(elia)).toHaveLength(2);

    index.replaceAll([{ id: elia, kind: 'character', slug: 'elia', path: 'character/elia.card', cardHash: 'sha256:cc' }]);

    expect(index.list()).toEqual([{ id: elia, kind: 'character', slug: 'elia', path: 'character/elia.card', cardHash: 'sha256:cc' }]);
    index.remove('character/elia.card');
    expect(index.list()).toEqual([]);
  });
});

describe('scene rename journal', () => {
  it('keeps an unfinished rename and how far it got until it is finished', async () => {
    const workspace: string = workspaces.create();
    const structure: StoryStructure = {
      threads: [{ id: 'main', title: '본편' }],
      scenes: [{ scene: rooftop, thread: 'main' }, { scene: arrival, thread: 'main' }],
    };
    const plan = planSceneRenames(structure, [
      { sceneId: arrival, slug: 'arrival', directoryName: '001-arrival.card', hasDraft: true },
      { sceneId: rooftop, slug: 'rooftop', directoryName: '002-rooftop.card', hasDraft: false },
    ]);
    const journal: JournalStore = new JournalStore(await workspaces.openCache(workspace));
    const begun = journal.beginSceneRename(plan.steps);
    journal.recordCompletedSteps(begun.id, 2);

    const reopened: JournalStore = new JournalStore(await workspaces.openCache(workspace));

    expect(reopened.findUnfinishedSceneRename()).toMatchObject({ id: begun.id, completedSteps: 2, steps: plan.steps });
    reopened.finish(begun.id);
    expect(reopened.findUnfinishedSceneRename()).toBeUndefined();
  });
});
