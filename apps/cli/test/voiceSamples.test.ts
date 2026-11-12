import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SceneDialogueStore, type WorkspaceCaches } from '@storyboard/story-engine';
import { NodeFileSystem } from '@storyboard/story-node';
import { getStoryboardProjectPaths, NodeUri, type SceneDialogueRecord } from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeCardBundleFromYaml } from './fixtures/cardBundles';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';
import { createWorkspaceCaches, createWorkspaceCards, createWorkspaceScenes } from './fixtures/workspaceCacheFixture';

let workspace: string;
let caches: WorkspaceCaches;

function store(): SceneDialogueStore {
  return new SceneDialogueStore(
    { fileSystem: new NodeFileSystem(), cards: createWorkspaceCards(caches), scenes: createWorkspaceScenes(caches) },
    getStoryboardProjectPaths(NodeUri.file(workspace)),
  );
}

function dialogue(lines: readonly string[]): SceneDialogueRecord {
  return {
    sceneStem: '001-harbor',
    bodyHash: `sha256:${'b'.repeat(64)}`,
    turns: lines.map((text, index) => ({ index: index + 1, speaker: 'hana', text })),
  };
}

function memoryText(): string {
  return readFileSync(join(workspace, 'character', 'hana.card', 'memory', 'main.yaml'), 'utf8');
}

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-voice-'));
  caches = createWorkspaceCaches();
  writeCardBundleFromYaml(workspace, 'type: character\nid: hana\nname: 하나\nrole: main\n');
  await writeSceneBundleFromYaml(workspace, 'type: scene\nid: 01-harbor\ntitle: 항구\n');
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('voice samples a generated draft leaves (A2)', () => {
  it('keeps the scene\'s representative lines in the character memory as draft:NNN, replacing them on a rerun', async () => {
    await store().save(dialogue(['만조엔 문이 열려. 난 분명히 봤어.', '등대 불은 내가 끄지 않을 거야.']));

    expect(memoryText()).toContain('source: draft:001');
    expect(memoryText()).toContain('만조엔 문이 열려. 난 분명히 봤어.');

    await store().save(dialogue(['바다는 거짓말을 하지 않는다고 했잖아.']));

    expect(memoryText()).not.toContain('만조엔 문이 열려');
    expect(memoryText()).toContain('바다는 거짓말을 하지 않는다고 했잖아.');
  });

  it('feeds only the lines notes left back into generation as voice seeds', async () => {
    await createWorkspaceCards(caches).writeMemory(NodeUri.file(workspace), 'character', 'hana', 'main', {
      voiceSample: [{ text: '달의 문 너머를 보고 싶어.', source: 'note:obsidian/인물/하나.md' }],
    });
    await store().save(dialogue(['만조엔 문이 열려. 난 분명히 봤어.']));

    expect(memoryText()).toContain('note:obsidian/인물/하나.md');
    expect((await store().loadVoiceSeeds()).characters).toEqual({ hana: ['달의 문 너머를 보고 싶어.'] });
  });
});
