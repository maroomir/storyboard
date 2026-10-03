import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireWorkspaceRunLock,
  createWorkspaceRunLockRecord,
  readWorkspaceRunLock,
  serializeWorkspaceRunLock,
  workspaceRunLockTiming,
  type WorkspaceRunLockHolder,
} from '@storyboard/story-engine';
import { NodeUri, STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-format';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandCatalog } from '../src/commands/catalog';
import { dispatch, type DispatchDependencies } from '../src/commands/dispatch';

const desktopHolder: WorkspaceRunLockHolder = {
  owner: 'desktop',
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

function lockFile(): string {
  return join(workspace, STORYBOARD_RELATIVE_PATHS.runLock);
}

function plantLock(heartbeatAt: Date): void {
  const record = createWorkspaceRunLockRecord(desktopHolder, 'desktop-token', heartbeatAt);
  writeFileSync(lockFile(), serializeWorkspaceRunLock(record));
}

function lockOptions(now?: () => Date): Parameters<typeof acquireWorkspaceRunLock>[0] {
  return {
    fileSystem: new NodeFileSystem(),
    workspaceRoot: NodeUri.file(workspace),
    holder: { owner: 'cli', label: 'storyboard scene generate', pid: 1, hostname: 'here' },
    ...(now === undefined ? {} : { now }),
  };
}

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-lock-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-lock-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);

  const init = await dispatch(['init', '--title', '잠금 시험'], deps());
  expect(init.exitCode).toBe(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('workspace run lock', () => {
  it('lets one holder in and turns the next one away until it releases', async () => {
    const first = await acquireWorkspaceRunLock(lockOptions());
    expect(first.ok).toBe(true);

    const second = await acquireWorkspaceRunLock({
      ...lockOptions(),
      holder: desktopHolder,
    });
    expect(second.ok).toBe(false);
    expect(second.ok ? undefined : second.heldBy.owner).toBe('cli');

    if (first.ok) {
      await first.lock.release();
    }

    expect(existsSync(lockFile())).toBe(false);
    expect((await acquireWorkspaceRunLock(lockOptions())).ok).toBe(true);
  });

  it('takes over a lock whose holder stopped beating', async () => {
    const abandonedAt = new Date('2026-09-27T00:00:00.000Z');
    plantLock(abandonedAt);
    const later = new Date(abandonedAt.getTime() + workspaceRunLockTiming.staleAfterMs + 1);

    expect(await readWorkspaceRunLock(lockOptions(() => later))).toBeUndefined();
    expect((await acquireWorkspaceRunLock(lockOptions(() => later))).ok).toBe(true);
  });

  it('ignores a lock file it cannot read instead of blocking forever', async () => {
    writeFileSync(lockFile(), 'not json');

    expect((await acquireWorkspaceRunLock(lockOptions())).ok).toBe(true);
  });

  it('never deletes a lock another holder took after it', async () => {
    const acquired = await acquireWorkspaceRunLock(lockOptions());
    expect(acquired.ok).toBe(true);
    plantLock(new Date());

    if (acquired.ok) {
      await acquired.lock.release();
    }

    expect(readFileSync(lockFile(), 'utf8')).toContain('desktop-token');
  });
});

describe('CLI verbs and the run lock', () => {
  it('refuses a writing verb while another app holds the workspace', async () => {
    plantLock(new Date());

    const result = await dispatch(['project', 'set', '--genre', '판타지'], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('데스크톱 앱이(가) «장편 생성» 작업 중입니다');
  });

  it('still answers read-only verbs while the workspace is held', async () => {
    plantLock(new Date());

    expect((await dispatch(['narrator', 'list'], deps())).exitCode).toBe(0);
  });

  it('releases the lock when a writing verb finishes', async () => {
    const result = await dispatch(['project', 'set', '--genre', '판타지'], deps());

    expect(result.exitCode).toBe(0);
    expect(existsSync(lockFile())).toBe(false);
  });

  // A new verb must say whether it writes the workspace. Guessing "no" would let it race a run.
  it('classifies every verb as writing or read-only', () => {
    const readOnlyVerbs = new Set([
      'init',
      'setup',
      'apikey set',
      'apikey show',
      'notes connect notion',
      'doctor',
      'config show',
      'config set',
      'params show',
      'completion',
      'tui',
      'help',
      'narrator list',
      'narrator show',
      'scene show',
      'scene draft',
      'card recommend character',
      'card recommend background',
      'canon diff',
      'check grammar',
      'check continuity',
      'check slop',
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
