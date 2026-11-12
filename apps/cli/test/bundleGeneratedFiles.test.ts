import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BundleFileAccess,
  ElementIndexStore,
  ElementMemoryRepository,
  SceneBundleFiles,
} from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const magicBoy: string = fileURLToPath(new URL('../../../packages/story-model/test/fixtures/bundles/magicboy/', import.meta.url));
const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const fileSystem: NodeFileSystem = new NodeFileSystem();
const elia = '3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44';
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
    expect((await scenes.readDialogue(scenePath))?.turns).toHaveLength(2);
    await scenes.writeDialogue(scenePath, { sceneStem: '002-rooftop', bodyHash, turns: [{ index: 1, speaker: elia, text: '야.' }] });
    expect((await scenes.readDialogue(scenePath))?.turns).toHaveLength(1);
    expect(await scenes.readSummary(scenePath)).toContain('전학 온 이유');
    expect(await scenes.readBeats('scene/009-none.card')).toEqual([]);
  });
});
