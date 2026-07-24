import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentService } from '../src/content/contentService';
import { MutateGate, createDefaultTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore } from '../src/workspace/workspaceStore';
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

describe('draft writes', () => {
  let fixture: WorkspaceFixture;
  let content: ContentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      { isTrackedPath: createDefaultTrackedPathPredicate() },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('writes a new draft without creating a commit', async () => {
    const outcome = await content.writeDraft('01-prologue', '# 프롤로그\n본문\n');

    expect(outcome).toEqual({ status: 'written', paths: ['draft/01-prologue.md'] });
    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toContain('프롤로그');
    // draft/ is gitignored, so history must be untouched.
    expect(git(fixture.root, 'log', '--format=%s').split('\n')).toHaveLength(1);
  });

  // draft/ cannot be recovered from git, so a regenerate must leave the old version somewhere.
  it('archives the previous draft under .draft/ before overwriting', async () => {
    await content.writeDraft('01-prologue', '첫 번째 초안\n');
    const outcome = await content.writeDraft('01-prologue', '두 번째 초안\n');

    expect(outcome.status).toBe('written');
    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toBe('두 번째 초안\n');

    const historyDirectory = join(fixture.root, '.draft', '01-prologue');
    expect(existsSync(historyDirectory)).toBe(true);
    const archived = readdirSync(historyDirectory);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/-rev-01\.md$/);
    expect(readFileSync(join(historyDirectory, archived[0] ?? ''), 'utf8')).toBe('첫 번째 초안\n');
  });

  it('does not archive when the regenerated draft is identical', async () => {
    await content.writeDraft('01-prologue', '같은 초안\n');
    const outcome = await content.writeDraft('01-prologue', '같은 초안\n');

    expect(outcome).toEqual({ status: 'no-op' });
    expect(existsSync(join(fixture.root, '.draft', '01-prologue'))).toBe(false);
  });

  it('numbers successive archives', async () => {
    await content.writeDraft('01-prologue', 'v1\n');
    await content.writeDraft('01-prologue', 'v2\n');
    await content.writeDraft('01-prologue', 'v3\n');

    const archived = readdirSync(join(fixture.root, '.draft', '01-prologue')).sort();
    expect(archived).toHaveLength(2);
    expect(archived[0]).toMatch(/-rev-01\.md$/);
    expect(archived[1]).toMatch(/-rev-02\.md$/);
  });

  it('refuses to write a draft while git is mid-operation', async () => {
    fixture.write('.git/index.lock', '');

    const outcome = await content.writeDraft('01-prologue', '본문\n');

    expect(outcome.status).toBe('blocked');
    expect(existsSync(join(fixture.root, 'draft', '01-prologue.md'))).toBe(false);
  });
});
