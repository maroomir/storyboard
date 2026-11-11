import { appendFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BundleWriteError,
  ElementBundleRepository,
  ElementIndexStore,
  StructureRepository,
  type ElementBundle,
} from '@storyboard/story-engine';
import { BundleFileError, NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const magicBoy: string = fileURLToPath(new URL('../../../packages/story-model/test/fixtures/bundles/magicboy/', import.meta.url));
const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const fileSystem: NodeFileSystem = new NodeFileSystem();

interface OpenedWork {
  readonly workspace: string;
  readonly bundles: ElementBundleRepository;
  readonly index: ElementIndexStore;
}

async function openMagicBoy(): Promise<OpenedWork> {
  const workspace: string = workspaces.create('storyboard-bundle-');
  cpSync(magicBoy, workspace, { recursive: true });
  const index: ElementIndexStore = new ElementIndexStore(await workspaces.openCache(workspace));
  const bundles: ElementBundleRepository = new ElementBundleRepository({ fileSystem, workspaceRoot: NodeUri.file(workspace), index });
  return { workspace, bundles, index };
}

function findBundle(bundles: readonly ElementBundle[], path: string): ElementBundle {
  const bundle: ElementBundle | undefined = bundles.find((candidate) => candidate.path === path);
  if (bundle === undefined) throw new Error(`no bundle at ${path}`);
  return bundle;
}

afterEach(() => workspaces.cleanUp());

describe('element bundle repository', () => {
  it('reads every bundle of the work and indexes it by path, uuid and slug', async () => {
    const { bundles, index } = await openMagicBoy();
    const listing = await bundles.listBundles();

    expect(listing.bundles.map((bundle) => bundle.path)).toEqual([
      'character/elia.card',
      'background/school.card',
      'scene/002-rooftop.card',
      'narrator/elia-first.card',
    ]);
    expect(listing.warnings).toEqual([]);
    expect(findBundle(listing.bundles, 'character/elia.card').statements).toHaveLength(9);
    expect(index.list('scene')).toEqual([expect.objectContaining({ slug: 'rooftop', path: 'scene/002-rooftop.card' })]);
  });

  it('warns once about a card changed outside the engine and reads it', async () => {
    const { workspace, bundles } = await openMagicBoy();
    await bundles.listBundles();
    appendFileSync(join(workspace, 'character/elia.card/statements.yaml'), '- {facet: traits, value: 고양이를 무서워한다, source: {origin: author, command: 손으로}}\n');

    const changed = await bundles.readBundle('character', 'elia.card');
    const again = await bundles.readBundle('character', 'elia.card');

    expect(changed.warnings.map((warning) => warning.kind)).toEqual(['changed-outside-engine']);
    expect(changed.bundle.statements).toHaveLength(10);
    expect(again.warnings).toEqual([]);
  });

  it('writes a bundle without warning about its own write', async () => {
    const { bundles } = await openMagicBoy();
    const { bundle } = await bundles.readBundle('character', 'elia.card');

    await bundles.writeBundle('character', {
      directoryName: 'elia.card',
      header: bundle.header,
      statements: [...bundle.statements, { facet: 'traits', value: '비 오는 날을 좋아한다', source: { origin: 'studio', session: 's1' } }],
    });

    expect((await bundles.readBundle('character', 'elia.card')).warnings).toEqual([]);
  });

  it('fails naming the file when a hand edit breaks the schema or gives the kind a foreign statement', async () => {
    const { workspace, bundles } = await openMagicBoy();
    writeFileSync(join(workspace, 'character/elia.card/card.yaml'), 'id: not-a-uuid\nslug: elia\nkind: character\nname: 엘리아\n');
    await expect(bundles.readBundle('character', 'elia.card')).rejects.toThrow(/character\/elia\.card\/card\.yaml/);

    appendFileSync(join(workspace, 'background/school.card/statements.yaml'), '- {facet: traits, value: 시끄럽다, source: {origin: studio}}\n');
    await expect(bundles.readBundle('background', 'school.card')).rejects.toThrow(BundleFileError);
  });

  it('lists the other bundles and names the one it cannot read', async () => {
    const { workspace, bundles } = await openMagicBoy();
    writeFileSync(join(workspace, 'character/elia.card/card.yaml'), 'kind: character\nid: [\n');

    const listing = await bundles.listBundles(['character', 'background']);

    expect(listing.bundles.map((bundle) => bundle.path)).not.toContain('character/elia.card');
    expect(listing.bundles.length).toBeGreaterThan(0);
    expect(listing.warnings).toContainEqual(
      expect.objectContaining({ kind: 'unreadable', paths: ['character/elia.card/card.yaml'] }),
    );
  });

  it('fails when a bundle folder has no card.yaml', async () => {
    const { workspace, bundles } = await openMagicBoy();
    mkdirSync(join(workspace, 'character/sera.card'));

    await expect(bundles.readBundle('character', 'sera.card')).rejects.toMatchObject({ code: 'missing-file' });
  });

  it('warns about files the bundle does not know and keeps the picture', async () => {
    const { workspace, bundles } = await openMagicBoy();
    writeFileSync(join(workspace, 'character/elia.card/profile.png'), 'png');
    writeFileSync(join(workspace, 'character/elia.card/notes.txt'), '메모');

    const { warnings } = await bundles.readBundle('character', 'elia.card');

    expect(warnings).toEqual([expect.objectContaining({ kind: 'unknown-entry', paths: ['character/elia.card/notes.txt'] })]);
  });

  it('warns about a copied bundle when reading and refuses to write either folder', async () => {
    const { workspace, bundles } = await openMagicBoy();
    cpSync(join(workspace, 'character/elia.card'), join(workspace, 'character/elia-copy.card'), { recursive: true });

    const listing = await bundles.listBundles(['character']);
    const copied = listing.warnings.find((warning) => warning.kind === 'copied-id');
    const original = findBundle(listing.bundles, 'character/elia.card');

    expect(copied?.paths).toEqual(['character/elia-copy.card', 'character/elia.card']);
    expect(listing.warnings.some((warning) => warning.kind === 'slug-mismatch')).toBe(true);
    await expect(
      bundles.writeBundle('character', { directoryName: 'elia.card', header: original.header, statements: original.statements }),
    ).rejects.toBeInstanceOf(BundleWriteError);
  });
});

describe('structure repository', () => {
  it('reads and writes structure.yaml and reports a work without one', async () => {
    const { workspace } = await openMagicBoy();
    const structures: StructureRepository = new StructureRepository({ fileSystem, workspaceRoot: NodeUri.file(workspace) });
    const structure = await structures.read();

    expect(structure?.scenes).toHaveLength(2);
    await structures.write({ threads: structure?.threads ?? [], scenes: structure?.scenes.slice(1) ?? [] });
    expect((await structures.read())?.scenes).toHaveLength(1);

    const empty: StructureRepository = new StructureRepository({ fileSystem, workspaceRoot: NodeUri.file(workspaces.create()) });
    expect(await empty.read()).toBeUndefined();
  });
});
