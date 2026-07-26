import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore, hashContent } from '../src/workspace/workspaceStore';
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

describe('MutateGate', () => {
  let fixture: WorkspaceFixture;
  let store: WorkspaceStore;
  let client: GitClient;
  let gate: MutateGate;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    store = new WorkspaceStore(fixture.root);
    client = new GitClient(fixture.root);
    const sync = new SyncService(client, {}, silentLogger);
    gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createGitTrackedPathPredicate(client),
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('writes a new tracked file and commits exactly that path', async () => {
    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'character/elia.card', content: 'id: elia\n', baselineHash: undefined },
        ],
      },
      'storygram: create character/elia.card',
    );

    expect(outcome).toEqual({ status: 'committed', paths: ['character/elia.card'] });
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toBe('id: elia\n');
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storygram: create character/elia.card',
    );
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
      'character/elia.card',
    );
  });

  it('updates an existing file when the baseline still matches', async () => {
    fixture.write('character/elia.card', 'id: elia\n');
    client.commit(['character/elia.card'], 'seed');
    const before = await store.readCard('character', 'elia').catch(() => undefined);
    const baseline = hashContent('id: elia\n');

    const outcome = await gate.apply(
      {
        writes: [
          {
            relativePath: 'character/elia.card',
            content: 'id: elia\nname: Elia\n',
            baselineHash: baseline,
          },
        ],
      },
      'storygram: update character/elia.card',
    );

    expect(before).toBeUndefined();
    expect(outcome.status).toBe('committed');
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toContain(
      'name: Elia',
    );
  });

  // The core concurrent-editing guarantee: a Desktop save between read and write must win.
  it('refuses the write when the file changed on disk after the baseline was taken', async () => {
    fixture.write('character/elia.card', 'id: elia\n');
    client.commit(['character/elia.card'], 'seed');
    const baseline = hashContent('id: elia\n');

    // Desktop saves the same file while the chat edit is in flight.
    fixture.write('character/elia.card', 'id: elia\nname: EditedInDesktop\n');

    const outcome = await gate.apply(
      {
        writes: [
          {
            relativePath: 'character/elia.card',
            content: 'id: elia\nname: FromBot\n',
            baselineHash: baseline,
          },
        ],
      },
      'storygram: update character/elia.card',
    );

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/elia.card', reason: 'changed-on-disk' }],
    });
    // The Desktop content survives untouched, and nothing was committed.
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toContain(
      'EditedInDesktop',
    );
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed');
  });

  it('refuses a create when the file already exists', async () => {
    fixture.write('character/elia.card', 'id: elia\n');

    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'character/elia.card', content: 'id: other\n', baselineHash: undefined },
        ],
      },
      'storygram: create character/elia.card',
    );

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/elia.card', reason: 'already-exists' }],
    });
  });

  it('refuses an update when the file was deleted on disk', async () => {
    const outcome = await gate.apply(
      {
        writes: [
          {
            relativePath: 'character/gone.card',
            content: 'id: gone\n',
            baselineHash: hashContent('x'),
          },
        ],
      },
      'storygram: update character/gone.card',
    );

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/gone.card', reason: 'deleted-on-disk' }],
    });
  });

  it('is a no-op when the content is identical, leaving no empty commit', async () => {
    fixture.write('character/elia.card', 'id: elia\n');
    client.commit(['character/elia.card'], 'seed');

    const outcome = await gate.apply(
      {
        writes: [
          {
            relativePath: 'character/elia.card',
            content: 'id: elia\n',
            baselineHash: hashContent('id: elia\n'),
          },
        ],
      },
      'storygram: update character/elia.card',
    );

    expect(outcome).toEqual({ status: 'no-op' });
    expect(git(fixture.root, 'log', '--format=%s').split('\n')).toHaveLength(2);
  });

  it('writes gitignored artifacts without committing them', async () => {
    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'draft/01-first.md', content: '# draft\n', baselineHash: undefined },
        ],
      },
      'storygram: generate draft/01-first.md',
    );

    expect(outcome).toEqual({ status: 'written', paths: ['draft/01-first.md'] });
    expect(readFileSync(join(fixture.root, 'draft', '01-first.md'), 'utf8')).toBe('# draft\n');
    // Still the fixture's initial commit — no draft commit was attempted.
    expect(git(fixture.root, 'log', '--format=%s').split('\n')).toHaveLength(1);
  });

  it('refuses to write while another git operation holds the index', async () => {
    fixture.write('.git/index.lock', '');

    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'character/elia.card', content: 'id: elia\n', baselineHash: undefined },
        ],
      },
      'storygram: create character/elia.card',
    );

    expect(outcome.status).toBe('blocked');
    // The refusal happens before any bytes are written.
    expect(() => readFileSync(join(fixture.root, 'character', 'elia.card'))).toThrow();
  });

  it('applies a multi-file change atomically per file and commits them together', async () => {
    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'character/a.card', content: 'id: a\n', baselineHash: undefined },
          { relativePath: 'character/b.card', content: 'id: b\n', baselineHash: undefined },
        ],
      },
      'storygram: create two cards',
    );

    expect(outcome.status).toBe('committed');
    expect(
      git(fixture.root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(),
    ).toEqual(['character/a.card', 'character/b.card']);
  });
});
