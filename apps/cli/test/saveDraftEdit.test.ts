import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SaveDraftEditUseCase } from '@storyboard/story-engine';
import { createDraft, NodeUri, parseDraft, serializeDraft } from '@storyboard/story-format';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const stem = '01-harbor';

let workspace: string;

function draftFile(): string {
  return join(workspace, 'draft', `${stem}.md`);
}

function historyFiles(): string[] {
  try {
    return readdirSync(join(workspace, '.draft', stem));
  } catch {
    return [];
  }
}

function save(body: string, archivePrevious: boolean): ReturnType<SaveDraftEditUseCase['execute']> {
  return new SaveDraftEditUseCase({ fileSystem: new NodeFileSystem() }).execute({
    workspaceRoot: NodeUri.file(workspace),
    sceneStem: stem,
    body,
    archivePrevious,
  });
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-edit-'));
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

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('SaveDraftEditUseCase', () => {
  it('keeps the generated version in history on the first save and replaces only the body', async () => {
    const result = await save('작가가 고친 문단.\n', true);

    expect(result).toMatchObject({ ok: true, kind: 'saved' });
    const saved = parseDraft(readFileSync(draftFile(), 'utf8'));
    expect(saved.body).toBe('작가가 고친 문단.\n');
    expect(saved.generatedAt).toBe('2026-09-27T00:00:00.000Z');
    expect(saved.warnings).toEqual(['too-short']);
    expect(historyFiles()).toHaveLength(1);
    expect(readFileSync(join(workspace, '.draft', stem, historyFiles()[0] ?? ''), 'utf8')).toContain(
      '생성된 첫 문단.',
    );
  });

  it('overwrites quietly on later saves of the same session', async () => {
    await save('한 번.\n', true);
    await save('두 번.\n', false);

    expect(historyFiles()).toHaveLength(1);
    expect(parseDraft(readFileSync(draftFile(), 'utf8')).body).toBe('두 번.\n');
  });

  it('writes nothing when the body did not change', async () => {
    expect(await save('생성된 첫 문단.\n', true)).toEqual({ ok: true, kind: 'unchanged' });
    expect(historyFiles()).toHaveLength(0);
  });

  it('reports a missing draft instead of creating one', async () => {
    rmSync(draftFile());

    expect(await save('새 글.\n', true)).toEqual({ ok: false, kind: 'missing' });
  });
});
