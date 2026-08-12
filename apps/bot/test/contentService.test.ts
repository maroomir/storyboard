import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCard } from '@seedkernel/wasm';
import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardEditError } from '../src/content/cardEditor';
import { ContentService } from '../src/content/contentService';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore } from '../src/workspace/workspaceStore';
import {
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

describe('ContentService', () => {
  let fixture: WorkspaceFixture;
  let content: ContentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed cards'], {
      shell: false,
    });

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
      },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('renames a card and commits exactly that file', async () => {
    const outcome = await content.renameCard('character', 'elia', '엘리아나');

    expect(outcome).toEqual({ status: 'committed', paths: ['character/elia.card'] });
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storygram: update character/elia.card',
    );

    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.name).toBe('엘리아나');
  });

  it('is a no-op when the new name matches what is already stored', async () => {
    const outcome = await content.renameCard('character', 'elia', '엘리아');

    expect(outcome).toEqual({ status: 'no-op' });
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed cards');
  });

  it('replaces a list field and keeps the file parseable', async () => {
    const outcome = await content.updateCardList('character', 'elia', 'traits', [
      '용감함',
      '신중함',
    ]);

    expect(outcome.status).toBe('committed');
    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.type).toBe('character');
    expect(saved.type === 'character' ? saved.traits : undefined).toEqual(['용감함', '신중함']);
  });

  it('rejects a character-only field on a background card', async () => {
    await expect(
      content.updateCardList('background', 'school', 'traits', ['x']),
    ).rejects.toBeInstanceOf(CardEditError);
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed cards');
  });

  it('rejects an empty value without touching the workspace', async () => {
    await expect(content.renameCard('character', 'elia', '   ')).rejects.toBeInstanceOf(
      CardEditError,
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  // End-to-end concurrent-edit guarantee through the public facade.
  it('refuses to overwrite a card that Desktop changed mid-edit', async () => {
    const store = new WorkspaceStore(fixture.root);
    const before = await store.readCard('character', 'elia');

    fixture.write(
      'character/elia.card',
      `${readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')}\ntags:\n  - desktop\n`,
    );

    // The service re-reads on its own, so it now sees the Desktop bytes and succeeds; the guard is
    // proven by planning against the stale snapshot explicitly.
    const { planCardRename } = await import('../src/content/cardEditor');
    const stalePlan = planCardRename(before, '엘리아');
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
      },
    );

    const outcome = await gate.apply(stalePlan.changes, stalePlan.commitMessage);

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/elia.card', reason: 'changed-on-disk' }],
    });
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toContain('desktop');
  });
});
