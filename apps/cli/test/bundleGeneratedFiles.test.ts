import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BundleFileAccess,
  ElementBundleRepository,
  ElementIndexStore,
  ElementMemoryRepository,
  SceneBundleFiles,
  ThreadLedgerReader,
} from '@storyboard/story-engine';
import { NodeUri, type StoryStructure } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const magicBoy: string = fileURLToPath(new URL('../../../packages/story-model/test/fixtures/bundles/magicboy/', import.meta.url));
const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const fileSystem: NodeFileSystem = new NodeFileSystem();
const elia = '3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44';
const sera = '7b1d2e90-4c3a-4f1b-8d2e-5a6b7c8d9e0f';
const arrival = '9d41b2c3-4d5e-4f6a-8b7c-1d2e3f4a5b6c';
const rooftop = 'c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b';
const letter = '4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b';
const bodyHash = `sha256:${'a'.repeat(64)}`;

interface OpenedWork {
  readonly workspace: string;
  readonly files: BundleFileAccess;
  readonly index: ElementIndexStore;
}

async function openMagicBoy(): Promise<OpenedWork> {
  const workspace: string = workspaces.create('storyboard-generated-');
  cpSync(magicBoy, workspace, { recursive: true });
  const workspaceRoot = NodeUri.file(workspace);
  const index: ElementIndexStore = new ElementIndexStore(await workspaces.openCache(workspace));
  return { workspace, files: new BundleFileAccess({ fileSystem, workspaceRoot }), index };
}

afterEach(() => workspaces.cleanUp());

describe('element memory', () => {
  it('keeps one memory file per thread inside the bundle', async () => {
    const { workspace, files } = await openMagicBoy();
    const memories: ElementMemoryRepository = new ElementMemoryRepository(files);

    expect((await memories.read('character/elia.card', 'main')).voiceSample).toHaveLength(2);
    expect(await memories.read('character/elia.card', 'jun')).toEqual({});

    await memories.write('character/elia.card', 'jun', { persona: '준 쪽에서 본 엘리아', voiceSample: [{ text: '응.', source: 'draft:003' }] });

    expect(existsSync(join(workspace, 'character/elia.card/memory/jun.yaml'))).toBe(true);
    expect(await memories.listThreads('character/elia.card')).toEqual(['jun', 'main']);
    expect(await memories.listThreads('narrator/elia-first.card')).toEqual([]);
  });
});

describe('scene bundle files', () => {
  it('reads and writes the beats, state, dialogue and the author note of a scene', async () => {
    const { files } = await openMagicBoy();
    const scenes: SceneBundleFiles = new SceneBundleFiles(files);
    const scenePath: string = 'scene/002-rooftop.card';

    expect(await scenes.readBeats(scenePath)).toHaveLength(2);
    await scenes.writeBeats(scenePath, [{ text: '엘리아가 난간에 기댄다', cast: [elia] }]);
    expect(await scenes.readBeats(scenePath)).toEqual([{ text: '엘리아가 난간에 기댄다', cast: [elia] }]);

    expect((await scenes.readState(scenePath))?.statements).toHaveLength(3);
    expect(await scenes.readDialogue(scenePath)).toBeUndefined();
    await scenes.writeDialogue(scenePath, { sceneStem: '002-rooftop', bodyHash, turns: [{ index: 1, speaker: elia, text: '야.' }] });
    expect((await scenes.readDialogue(scenePath))?.turns).toHaveLength(1);
    expect(await scenes.readSummary(scenePath)).toBeUndefined();
    expect(await scenes.readBeats('scene/009-none.card')).toEqual([]);
  });
});

describe('thread ledger', () => {
  it('joins the scene states of a thread in the structure order and stops before the asked scene', async () => {
    const { workspace, files, index } = await openMagicBoy();
    const scenes: SceneBundleFiles = new SceneBundleFiles(files);
    mkdirSync(join(workspace, 'scene', '001-arrival.card'));
    mkdirSync(join(workspace, 'scene', '003-letter.card'));
    await files.writeText('scene/001-arrival.card/card.yaml', `id: ${arrival}\nslug: arrival\nkind: scene\ntitle: 도착\n`);
    await files.writeText('scene/003-letter.card/card.yaml', `id: ${letter}\nslug: letter\nkind: scene\ntitle: 편지\n`);
    await scenes.writeState('scene/001-arrival.card', {
      statements: [{ facet: 'event', value: '엘리아가 전학 온다', knownBy: [elia, sera] }],
    });
    await scenes.writeState('scene/003-letter.card', { statements: [{ facet: 'reveal', value: '준이 편지를 쓴다' }] });
    await new ElementBundleRepository({ fileSystem, workspaceRoot: NodeUri.file(workspace), index }).listBundles(['scene']);

    const structure: StoryStructure = {
      threads: [{ id: 'main', title: '본편' }, { id: 'jun', title: '준' }],
      scenes: [
        { scene: arrival, thread: 'main' },
        { scene: rooftop, thread: 'main' },
        { scene: letter, thread: 'jun' },
      ],
    };
    const ledger: ThreadLedgerReader = new ThreadLedgerReader({ sceneFiles: scenes, index });

    expect((await ledger.readThread({ structure, threadId: 'main' })).map((entry) => entry.sceneId)).toEqual([arrival, rooftop]);
    expect((await ledger.readThread({ structure, threadId: 'main', beforeSceneId: rooftop })).map((entry) => entry.sceneId)).toEqual([arrival]);
    expect((await ledger.readThread({ structure, threadId: 'jun' })).map((entry) => entry.state.statements[0]?.facet)).toEqual(['reveal']);
  });
});
