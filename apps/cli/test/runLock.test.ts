import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WorkspaceCaches, WorkspaceRunLocks } from '@storyboard/story-engine';
import {
  workspaceRunLockTiming,
  type WorkspaceRunLockHolder,
  NodeUri,
} from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceCaches,
  createWorkspaceRunLocks,
  plantRunLock,
  readRunLockToken,
} from './fixtures/workspaceCacheFixture';

import { commandCatalog } from '@/commands/index';
import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';

const extensionHolder: WorkspaceRunLockHolder = {
  owner: 'vscode',
  label: '장편 생성',
  pid: 4242,
  hostname: 'writer-mac',
};

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

let home: string;
let workspace: string;
let caches: WorkspaceCaches;

const cliHolder: WorkspaceRunLockHolder = {
  owner: 'cli',
  label: 'storyboard draft generate',
  pid: 1,
  hostname: 'here',
};

async function plantLock(
  heartbeatAt: Date,
  holder: WorkspaceRunLockHolder = extensionHolder,
): Promise<void> {
  await plantRunLock(caches, workspace, holder, heartbeatAt);
}

function runLocks(now?: () => Date): WorkspaceRunLocks {
  return createWorkspaceRunLocks(caches, now);
}

function root(): NodeUri {
  return NodeUri.file(workspace);
}

function deps(): DispatchDependencies {
  return {
    version: '0.0.0',
    cwd: workspace,
    isInteractive: false,
    createLogger: () => silentLogger,
  };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-lock-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-lock-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  caches = createWorkspaceCaches();

  const init = await new CommandDispatcher(deps()).dispatch(['init', '--title', '잠금 시험']);
  expect(init.exitCode).toBe(0);
});

afterEach(async () => {
  await caches.closeAll();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('workspace run lock', () => {
  it('lets one holder in and turns the next one away until it releases', async () => {
    const first = await runLocks().acquire(root(), cliHolder);
    expect(first.ok).toBe(true);

    const second = await runLocks().acquire(root(), extensionHolder);
    expect(second.ok).toBe(false);
    expect(second.ok ? undefined : second.heldBy.owner).toBe('cli');

    if (first.ok) {
      await first.lock.release();
    }

    expect(await readRunLockToken(caches, workspace)).toBeUndefined();
    expect((await runLocks().acquire(root(), cliHolder)).ok).toBe(true);
  });

  it('takes over a lock whose holder stopped beating', async () => {
    const abandonedAt = new Date('2026-09-27T00:00:00.000Z');
    await plantLock(abandonedAt);
    const later = new Date(abandonedAt.getTime() + workspaceRunLockTiming.staleAfterMs + 1);

    expect(await runLocks(() => later).readHolder(root())).toBeUndefined();
    expect((await runLocks(() => later).acquire(root(), cliHolder)).ok).toBe(true);
  });

  it('takes over at once a lock whose holder process on this machine is gone', async () => {
    const noSuchPid: number = 2 ** 22 + 12345;
    await plantLock(new Date(), { ...extensionHolder, pid: noSuchPid, hostname: hostname() });

    expect(await runLocks().readHolder(root())).toBeUndefined();
    expect((await runLocks().acquire(root(), cliHolder)).ok).toBe(true);
  });

  it('keeps a fresh lock whose holder process on this machine is still running', async () => {
    await plantLock(new Date(), { ...extensionHolder, pid: process.pid, hostname: hostname() });

    expect((await runLocks().readHolder(root()))?.pid).toBe(process.pid);
    expect((await runLocks().acquire(root(), cliHolder)).ok).toBe(false);
  });

  it('never deletes a lock another holder took after it', async () => {
    const acquired = await runLocks().acquire(root(), cliHolder);
    expect(acquired.ok).toBe(true);
    await plantLock(new Date());

    if (acquired.ok) {
      await acquired.lock.release();
    }

    expect(await readRunLockToken(caches, workspace)).toBe('extension-token');
  });
});

describe('CLI verbs and the run lock', () => {
  it('refuses a writing verb while another app holds the workspace', async () => {
    await plantLock(new Date());

    const result = await new CommandDispatcher(deps()).dispatch(['project', 'set', '--genre', '판타지']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('VSCode 확장이(가) «장편 생성» 작업 중입니다');
  });

  it('still answers read-only verbs while the workspace is held', async () => {
    await plantLock(new Date());

    expect((await new CommandDispatcher(deps()).dispatch(['card', 'list', 'narrator'])).exitCode).toBe(0);
  });

  it('answers the read-only form of a writing verb while the workspace is held', async () => {
    await plantLock(new Date());

    const result = await new CommandDispatcher(deps()).dispatch(['manuscript', 'review', '--show']);

    expect(result.stdout).not.toContain('작업 중입니다');
    expect(result.exitCode).toBe(0);
  });

  it('releases the lock when a writing verb finishes', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['project', 'set', '--genre', '판타지']);

    expect(result.exitCode).toBe(0);
    expect(await readRunLockToken(caches, workspace)).toBeUndefined();
  });

  it('classifies every verb as writing or read-only', () => {
    const readOnlyVerbs = new Set([
      'init',
      'setup',
      'apikey set',
      'login',
      'logout',
      'apikey show',
      'notes connect',
      'notes export',
      'doctor',
      'status',
      'config show',
      'config set',
      'config unset',
      'params show',
      'completion',
      'tui',
      'help',
      'project show',
      'scene list',
      'scene show',
      'outline show',
      'draft show',
      'card list',
      'card show',
      'card interview',
      'card recommend',
      'draft check',
      'manuscript export',
      'sim run',
      'sim screen',
      'sim sweep',
      'sim report',
      'sim rejudge',
      'sim apply',
    ]);

    const unclassified = commandCatalog
      .filter((spec) => spec.writesWorkspace !== true && !readOnlyVerbs.has(spec.verb))
      .map((spec) => spec.verb);
    const contradictory = commandCatalog
      .filter((spec) => spec.writesWorkspace === true && readOnlyVerbs.has(spec.verb))
      .map((spec) => spec.verb);

    expect(unclassified).toEqual([]);
    expect(contradictory).toEqual([]);
  });
});
