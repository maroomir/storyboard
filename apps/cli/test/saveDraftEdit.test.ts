import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SaveDraftEditUseCase,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import { createDraft, NodeUri, parseDraft, serializeDraft } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHost } from '@storyboard/story-engine/testing';

import { createWorkspaceCaches, createWorkspaceScenes } from './fixtures/workspaceCacheFixture';
import {
  draftRevisionDirectory,
  listDraftRevisions,
  writeSceneBundleFromYaml,
} from './fixtures/sceneBundles';

const stem = '001-harbor';

let workspace: string;
let caches: WorkspaceCaches;

function draftFile(): string {
  return join(workspace, 'draft', `${stem}.md`);
}

async function historyFiles(): Promise<string[]> {
  return await listDraftRevisions(workspace, stem);
}

function save(body: string): ReturnType<SaveDraftEditUseCase['execute']> {
  return new SaveDraftEditUseCase(
    createTestHost({
      fileSystem: new NodeFileSystem(),
      scenes: createWorkspaceScenes(caches),
    }),
  ).execute({
    workspaceRoot: NodeUri.file(workspace),
    sceneStem: stem,
    body,
  });
}

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-edit-'));
  caches = createWorkspaceCaches();
  await writeSceneBundleFromYaml(workspace, `type: scene\nid: ${stem}\n`);
  mkdirSync(join(workspace, 'draft'), { recursive: true });
  writeFileSync(
    draftFile(),
    serializeDraft(
      createDraft({
        sceneStem: stem,
        format: 'novel',
        body: '생성된 첫 문단.\n',
        generatedAt: '2026-09-27T00:00:00.000Z',
        warnings: ['too-short'],
      }),
    ),
  );
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('SaveDraftEditUseCase', () => {
  it('keeps the generated version in history on the first save and replaces only the body', async () => {
    const result = await save('작가가 고친 문단.\n');

    expect(result).toMatchObject({ ok: true, kind: 'saved' });
    const saved = parseDraft(readFileSync(draftFile(), 'utf8'));
    expect(saved.body).toBe('작가가 고친 문단.\n');
    expect(saved.generatedAt).toBe('2026-09-27T00:00:00.000Z');
    expect(saved.warnings).toEqual(['too-short']);
    expect(await historyFiles()).toHaveLength(1);
    expect(
      readFileSync(
        join(await draftRevisionDirectory(workspace, stem), (await historyFiles())[0] ?? ''),
        'utf8',
      ),
    ).toContain('생성된 첫 문단.');
  });

  it('keeps the version it replaces on every save', async () => {
    await save('한 번.\n');
    await save('두 번.\n');

    expect(await historyFiles()).toHaveLength(2);
    expect(parseDraft(readFileSync(draftFile(), 'utf8')).body).toBe('두 번.\n');
  });

  it('writes nothing when the body did not change', async () => {
    expect(await save('생성된 첫 문단.\n')).toEqual({ ok: true, kind: 'unchanged' });
    expect(await historyFiles()).toHaveLength(0);
  });

  it('reports a missing draft instead of creating one', async () => {
    rmSync(draftFile());

    expect(await save('새 글.\n')).toEqual({ ok: false, kind: 'missing' });
  });
});
