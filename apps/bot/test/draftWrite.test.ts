import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentService } from '../src/content/contentService';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
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
      { isTrackedPath: createGitTrackedPathPredicate(client) },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('writes a new draft without creating a commit', async () => {
    const outcome = await content.writeDraft('01-prologue', '# 프롤로그\n본문\n');

    expect(outcome).toEqual({ status: 'written', paths: ['draft/01-prologue.md'] });
    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toContain(
      '프롤로그',
    );
    // draft/ is gitignored, so history must be untouched.
    expect(git(fixture.root, 'log', '--format=%s').split('\n')).toHaveLength(1);
  });

  // draft/ cannot be recovered from git, so a regenerate must leave the old version somewhere.
  it('archives the previous draft under .draft/ before overwriting', async () => {
    await content.writeDraft('01-prologue', '첫 번째 초안\n');
    const outcome = await content.writeDraft('01-prologue', '두 번째 초안\n');

    expect(outcome.status).toBe('written');
    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toBe(
      '두 번째 초안\n',
    );

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

// A refused draft is minutes of generation and provider spend. The guard discards it by design so
// the concurrent edit wins, so the body has to survive somewhere ignored or the cost is simply lost.
describe('a draft refused by the freshness guard', () => {
  let fixture: WorkspaceFixture;
  let content: ContentService;
  // Set to the bytes a Desktop save lands between the job's read and its write; cleared once used.
  let pendingDesktopEdit: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    pendingDesktopEdit = undefined;
    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
        onWillWrite: (relativePath) => {
          if (relativePath === 'draft/01-prologue.md' && pendingDesktopEdit !== undefined) {
            fixture.write('draft/01-prologue.md', pendingDesktopEdit);
            pendingDesktopEdit = undefined;
          }
        },
      },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('keeps the generated body under .draft/ and names it in the outcome', async () => {
    await content.writeDraft('01-prologue', '# 프롤로그\n1차 본문\n');
    pendingDesktopEdit = '# 프롤로그\n작가가 손으로 고친 본문\n';

    const outcome = await content.writeDraft('01-prologue', '# 프롤로그\n봇이 새로 만든 본문\n');

    expect(outcome.status).toBe('stale');
    if (outcome.status !== 'stale') {
      return;
    }

    expect(outcome.preservedPath).toMatch(/^\.draft\/01-prologue\/.*-refused-01\.md$/);
    expect(readFileSync(join(fixture.root, outcome.preservedPath ?? ''), 'utf8')).toBe(
      '# 프롤로그\n봇이 새로 만든 본문\n',
    );
    // The writer that won is untouched: the bot never resolves the conflict for the user.
    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toBe(
      '# 프롤로그\n작가가 손으로 고친 본문\n',
    );
  });

  it('does not overwrite an earlier refusal or disturb the revision numbering', async () => {
    await content.writeDraft('01-prologue', '# 프롤로그\n1차 본문\n');

    pendingDesktopEdit = '# 프롤로그\n작가 수정 1\n';
    const first = await content.writeDraft('01-prologue', '# 프롤로그\n거부본 A\n');
    pendingDesktopEdit = '# 프롤로그\n작가 수정 2\n';
    const second = await content.writeDraft('01-prologue', '# 프롤로그\n거부본 B\n');

    const preserved = [first, second].map((outcome) =>
      outcome.status === 'stale' ? outcome.preservedPath : undefined,
    );

    expect(preserved[0]).toMatch(/-refused-01\.md$/);
    expect(preserved[1]).toMatch(/-refused-02\.md$/);

    const archived = readdirSync(join(fixture.root, '.draft', '01-prologue')).sort();
    expect(archived.filter((name) => name.includes('-refused-'))).toHaveLength(2);
    // The rev-NN history keeps counting from its own series.
    expect(archived.filter((name) => name.includes('-rev-')).length).toBeGreaterThan(0);
  });
});

// A workspace that tracks draft/ (Desktop's trackDraft: no draft/ line in .gitignore) must get its
// generated drafts committed — tracked-ness follows the workspace's own git rules.
describe('draft writes in a trackDraft workspace', () => {
  let fixture: WorkspaceFixture;
  let content: ContentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    fixture.write('.gitignore', ['.storyboard/cache/', '.draft/', 'manuscript/', ''].join('\n'));
    git(fixture.root, 'add', '--all');
    git(fixture.root, 'commit', '--quiet', '-m', 'track drafts');

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      { isTrackedPath: createGitTrackedPathPredicate(client) },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('commits the generated draft and leaves the tree clean', async () => {
    const outcome = await content.writeDraft('01-prologue', '# 초안\n');

    expect(outcome).toEqual({ status: 'committed', paths: ['draft/01-prologue.md'] });
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storyboard-bot: generate draft/01-prologue.md',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  it('keeps the .draft/ history archive out of the commit', async () => {
    await content.writeDraft('01-prologue', 'v1\n');
    const outcome = await content.writeDraft('01-prologue', 'v2\n');

    expect(outcome.status).toBe('committed');
    // The archive was written but .draft/ stays ignored, so only the draft itself is in history.
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
      'draft/01-prologue.md',
    );
    expect(readdirSync(join(fixture.root, '.draft', '01-prologue'))).toHaveLength(1);
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });
});

describe('memory commits', () => {
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
      { isTrackedPath: createGitTrackedPathPredicate(client) },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('commits every memory file a job touched in one commit', async () => {
    fixture.write('.storyboard/memory/storyState.md', '# 상태\n');
    fixture.write('.storyboard/memory/dialogue/01-prologue.json', '{"turns":[]}\n');

    const outcome = content.commitMemory(
      ['.storyboard/memory/storyState.md', '.storyboard/memory/dialogue/01-prologue.json'],
      'storyboard-bot: update memory for 01-prologue',
    );

    expect(outcome?.status).toBe('committed');
    expect(git(fixture.root, 'log', '--format=%s').split('\n')[0]).toBe(
      'storyboard-bot: update memory for 01-prologue',
    );
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(
      ['.storyboard/memory/dialogue/01-prologue.json', '.storyboard/memory/storyState.md'],
    );
  });

  it("leaves the user's unrelated edits out of the memory commit", async () => {
    fixture.write('.storyboard/memory/storyState.md', '# 상태\n');
    fixture.write('scene/01-prologue.card', 'type: scene\n');

    content.commitMemory(
      ['.storyboard/memory/storyState.md'],
      'storyboard-bot: update memory for 01-prologue',
    );

    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
      '.storyboard/memory/storyState.md',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toContain('scene/');
  });

  it('reports nothing when the job wrote no memory', async () => {
    expect(content.commitMemory([], 'storyboard-bot: update memory')).toEqual({ status: 'no-op' });
  });
});
