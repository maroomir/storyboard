import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GitClient,
  SyncService,
  ensureWorkspaceGitignore,
  initializeWorkspaceRepository,
  inspectWorkspaceRepository,
} from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe('GitClient', () => {
  let fixture: WorkspaceFixture;

  beforeEach(() => {
    fixture = createWorkspaceFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('commits only the paths it is given, never sweeping unrelated work', () => {
    const client = new GitClient(fixture.root);
    fixture.write('character/elia.card', 'id: elia\nname: Elia\n');
    fixture.write('character/unrelated.card', 'id: unrelated\n');

    const committed = client.commit(
      ['character/elia.card'],
      'storygram: update character/elia.card',
    );

    expect(committed).toBe(true);
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
      'character/elia.card',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toContain('character/unrelated.card');
  });

  it('reports no-op when the content did not change', () => {
    const client = new GitClient(fixture.root);
    fixture.write('character/elia.card', 'id: elia\n');
    client.commit(['character/elia.card'], 'storygram: create character/elia.card');

    expect(client.commit(['character/elia.card'], 'storygram: no change')).toBe(false);
  });

  it('detects a locked index as a blocker', () => {
    const client = new GitClient(fixture.root);
    writeFileSync(join(fixture.root, '.git', 'index.lock'), '');

    expect(client.findBlocker()).toBe('index-locked');

    rmSync(join(fixture.root, '.git', 'index.lock'));
    expect(client.findBlocker()).toBeUndefined();
  });

  it('detects a missing identity as a blocker', () => {
    // hasIdentity() reads the EFFECTIVE config, so the machine's global identity has to be masked
    // for the repo-local unset to actually leave the author unset.
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';

    try {
      git(fixture.root, 'config', '--local', '--unset', 'user.email');
      expect(new GitClient(fixture.root).findBlocker()).toBe('no-identity');

      git(fixture.root, 'config', '--local', 'user.email', 'fixture@example.com');
      expect(new GitClient(fixture.root).findBlocker()).toBeUndefined();
    } finally {
      restoreEnv('GIT_CONFIG_GLOBAL', previousGlobal);
      restoreEnv('GIT_CONFIG_SYSTEM', previousSystem);
    }
  });
});

describe('workspace onboarding', () => {
  it('reports needs-init for a workspace that is not a repository', () => {
    const bare = createWorkspaceFixture({ initGit: false });

    const report = inspectWorkspaceRepository(bare.root);

    expect(report.status).toBe('needs-init');
    expect(report.blocker).toBe('not-a-repository');
    bare.cleanup();
  });

  it('initializes, ignores generated files, and makes a baseline commit', () => {
    const bare = createWorkspaceFixture({ initGit: false });
    bare.write('draft/01-first.md', 'generated draft\n');
    bare.write('character/elia.card', 'id: elia\n');
    // Simulate a workspace whose .gitignore predates Storyboard.
    writeFileSync(join(bare.root, '.gitignore'), 'node_modules/\n');

    execFileSync('git', ['-C', bare.root, 'init', '--quiet', '--initial-branch=main'], {
      shell: false,
    });
    execFileSync('git', ['-C', bare.root, 'config', 'user.name', 'Fixture'], { shell: false });
    execFileSync('git', ['-C', bare.root, 'config', 'user.email', 'f@example.com'], {
      shell: false,
    });

    const result = initializeWorkspaceRepository(bare.root);

    expect(result.gitignoreUpdated).toBe(true);
    expect(result.committed).toBe(true);

    const tracked = git(bare.root, 'ls-files');
    expect(tracked).toContain('character/elia.card');
    // The whole point of ignoring first: generated drafts must never enter history.
    expect(tracked).not.toContain('draft/01-first.md');
    expect(inspectWorkspaceRepository(bare.root).status).toBe('ready');

    bare.cleanup();
  });

  it('does not duplicate the ignore block on a second run', () => {
    const bare = createWorkspaceFixture({ initGit: false });

    expect(ensureWorkspaceGitignore(bare.root)).toBe(true);
    expect(ensureWorkspaceGitignore(bare.root)).toBe(false);

    const content = readFileSync(join(bare.root, '.gitignore'), 'utf8');
    expect(content.match(/# Storyboard generated files/g)).toHaveLength(1);

    bare.cleanup();
  });
});

describe('SyncService', () => {
  let fixture: WorkspaceFixture;

  beforeEach(() => {
    fixture = createWorkspaceFixture();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('settles as no-remote without touching the network when no remote is configured', () => {
    const service = new SyncService(new GitClient(fixture.root), {}, silentLogger);

    const report = service.syncNow();

    expect(report).toEqual({ state: 'no-remote', pushed: false, conflicts: [] });
    expect(service.getState()).toBe('no-remote');
  });

  it('still commits every save when there is no remote', () => {
    const service = new SyncService(new GitClient(fixture.root), {}, silentLogger);
    fixture.write('character/elia.card', 'id: elia\n');

    service.commitOnWrite(['character/elia.card'], 'storygram: create character/elia.card');

    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storygram: create character/elia.card',
    );
  });

  it('pushes ahead commits to a real bare origin', () => {
    const origin = mkdtempSync(join(tmpdir(), 'storygram-origin-'));
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origin], {
      shell: false,
    });
    git(fixture.root, 'remote', 'add', 'origin', origin);
    git(fixture.root, 'push', '--quiet', '-u', 'origin', 'main');

    const service = new SyncService(
      new GitClient(fixture.root),
      { remote: 'origin' },
      silentLogger,
    );
    fixture.write('character/elia.card', 'id: elia\n');
    service.commitOnWrite(['character/elia.card'], 'storygram: create character/elia.card');

    const report = service.syncNow();

    expect(report.state).toBe('clean');
    expect(report.pushed).toBe(true);

    rmSync(origin, { recursive: true, force: true });
  });

  it('aborts a conflicting rebase, preserves the local commit, and reports conflict', () => {
    const origin = mkdtempSync(join(tmpdir(), 'storygram-origin-'));
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origin], {
      shell: false,
    });
    git(fixture.root, 'remote', 'add', 'origin', origin);
    git(fixture.root, 'push', '--quiet', '-u', 'origin', 'main');

    // Another clone lands a conflicting change on the same file.
    const other = mkdtempSync(join(tmpdir(), 'storygram-other-'));
    execFileSync('git', ['clone', '--quiet', origin, other], { shell: false });
    git(other, 'config', 'user.name', 'Other');
    git(other, 'config', 'user.email', 'other@example.com');
    mkdirSync(join(other, 'character'), { recursive: true });
    writeFileSync(join(other, 'character', 'elia.card'), 'id: elia\nname: FromRemote\n');
    git(other, 'add', '--all');
    git(other, 'commit', '--quiet', '-m', 'remote change');
    git(other, 'push', '--quiet');

    fixture.write('character/elia.card', 'id: elia\nname: FromBot\n');
    const client = new GitClient(fixture.root);
    client.commit(['character/elia.card'], 'storygram: update character/elia.card');
    const localHead = git(fixture.root, 'rev-parse', 'HEAD');

    const notify = vi.fn();
    const service = new SyncService(client, { remote: 'origin' }, silentLogger, notify);
    const report = service.syncNow();

    expect(report.state).toBe('conflict');
    expect(report.conflicts).toContain('character/elia.card');
    expect(notify).toHaveBeenCalledOnce();
    // The local commit survives and no rebase is left half-applied.
    expect(git(fixture.root, 'rev-parse', 'HEAD')).toBe(localHead);
    expect(existsSync(join(fixture.root, '.git', 'rebase-merge'))).toBe(false);

    rmSync(origin, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });

  it('reports offline when the remote is unreachable', () => {
    git(fixture.root, 'remote', 'add', 'origin', join(tmpdir(), 'storygram-missing-origin.git'));

    const service = new SyncService(
      new GitClient(fixture.root),
      { remote: 'origin' },
      silentLogger,
    );
    const report = service.syncNow();

    expect(report.state).toBe('offline');
    expect(report.pushed).toBe(false);
  });

  it('invalidates edit baselines when a rebase applies remote commits', () => {
    const origin = mkdtempSync(join(tmpdir(), 'storygram-origin-'));
    execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origin], {
      shell: false,
    });
    git(fixture.root, 'remote', 'add', 'origin', origin);
    git(fixture.root, 'push', '--quiet', '-u', 'origin', 'main');

    const other = mkdtempSync(join(tmpdir(), 'storygram-other-'));
    execFileSync('git', ['clone', '--quiet', origin, other], { shell: false });
    git(other, 'config', 'user.name', 'Other');
    git(other, 'config', 'user.email', 'other@example.com');
    mkdirSync(join(other, 'scene'), { recursive: true });
    writeFileSync(join(other, 'scene', '01-remote.txt'), 'remote scene\n');
    git(other, 'add', '--all');
    git(other, 'commit', '--quiet', '-m', 'remote scene');
    git(other, 'push', '--quiet');

    const service = new SyncService(
      new GitClient(fixture.root),
      { remote: 'origin' },
      silentLogger,
    );
    const invalidate = vi.fn();
    service.setRemoteCommitsAppliedHook(invalidate);

    const report = service.syncNow();

    expect(report.state).toBe('clean');
    expect(invalidate).toHaveBeenCalledOnce();

    rmSync(origin, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
});
