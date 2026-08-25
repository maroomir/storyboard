import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCard, serializeCard } from '@storyboard/story-format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceError, WorkspaceStore, hashContent } from '../src/workspace/workspaceStore';
import {
  SHARED_FIXTURE_ROOT,
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

describe('WorkspaceStore', () => {
  let fixture: WorkspaceFixture;
  let store: WorkspaceStore;

  beforeEach(() => {
    fixture = createWorkspaceFixture();
    store = new WorkspaceStore(fixture.root);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('accepts a directory carrying the project manifest', async () => {
    await expect(store.assertIsWorkspace()).resolves.toBeUndefined();
  });

  it('rejects a directory without the project manifest', async () => {
    const bare = createWorkspaceFixture({ initGit: false });
    const bareStore = new WorkspaceStore(join(bare.root, 'nested'));

    await expect(bareStore.assertIsWorkspace()).rejects.toBeInstanceOf(WorkspaceError);
    bare.cleanup();
  });

  it('rejects a relative workspace path', () => {
    expect(() => new WorkspaceStore('relative/path')).toThrow(WorkspaceError);
  });

  it('reads the project manifest with a content hash', async () => {
    const project = await store.readProject();

    expect(project.value.name).toBe('fixture-novel');
    expect(project.relativePath).toBe('.storyboard/project.json');
    expect(project.contentHash).toHaveLength(64);
  });

  it('lists character and background cards, skipping sample cards', async () => {
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    fixture.write('character/.sample.card', 'id: sample\n');

    const cards = await store.listCards();

    expect(cards).toEqual([
      { id: 'elia', kind: 'character', relativePath: 'character/elia.card' },
      { id: 'school', kind: 'background', relativePath: 'background/school.card' },
    ]);
  });

  it('lists scenes ordered by their numeric prefix', async () => {
    fixture.write('scene/02-second.card', 'type: scene\nid: 02-second\nsummary: second\n');
    fixture.write('scene/01-first.card', 'type: scene\nid: 01-first\nsummary: first\n');
    fixture.write('scene/.sample.card', 'ignored\n');
    fixture.write('scene/not-a-scene.md', 'ignored\n');

    const scenes = await store.listScenes();

    expect(scenes.map((scene) => scene.stem)).toEqual(['01-first', '02-second']);
    expect(scenes[0]?.relativePath).toBe('scene/01-first.card');
  });

  it('returns undefined for optional files that do not exist', async () => {
    await expect(store.readBible()).resolves.toBeUndefined();
    await expect(store.readChapterPlan()).resolves.toBeUndefined();
    await expect(store.readSynopsis()).resolves.toBeUndefined();
    await expect(store.readDraft('01-first')).resolves.toBeUndefined();
  });

  it('reports a different hash after the file changes on disk', async () => {
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    const before = await store.readCard('character', 'elia');

    fixture.write('character/elia.card', `${before.contentHash}\nid: elia\nname: Elia\n`);
    const after = await store.readCard('character', 'elia').catch(() => undefined);

    expect(after?.contentHash).not.toBe(before.contentHash);
  });
});

// The whole point of packages/story-format is that both apps agree on the bytes. If the bot ever
// re-serializes a card differently from the extension, this fails.
describe('story-format round-trip', () => {
  it.each(['character.card', 'background.card'])(
    'round-trips %s without changing the serialized bytes',
    (fixtureName) => {
      const raw = readFileSync(join(SHARED_FIXTURE_ROOT, 'cards', fixtureName), 'utf8');

      expect(serializeCard(parseCard(raw))).toBe(raw);
    },
  );

  it('hashes content deterministically', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });
});
