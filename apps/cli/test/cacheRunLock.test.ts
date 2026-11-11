import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CacheDatabase, RunLockStore } from '@storyboard/story-engine';
import { NodeUri, type WorkspaceRunLockHolder } from '@storyboard/story-model';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';

const workspaces: string[] = [];
const databases: CacheDatabase[] = [];
const cliHolder: WorkspaceRunLockHolder = { owner: 'cli', label: 'draft generate', pid: 101, hostname: 'here' };
const editorHolder: WorkspaceRunLockHolder = { owner: 'vscode', label: '씬 생성', pid: 202, hostname: 'here' };

async function openDatabase(workspace: string): Promise<CacheDatabase> {
  const { database } = await CacheDatabase.open({
    host: new NodeSqlDatabaseHost(),
    fileSystem: new NodeFileSystem(),
    workspaceRoot: NodeUri.file(workspace),
  });
  databases.push(database);
  return database;
}

async function openWorkspace(): Promise<string> {
  const workspace: string = mkdtempSync(join(tmpdir(), 'storyboard-lock-'));
  workspaces.push(workspace);
  return workspace;
}

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  workspaces.splice(0).forEach((workspace) => rmSync(workspace, { recursive: true, force: true }));
});

describe('run lock in the cache database', () => {
  it('lets one writer in and names it to the next one, even from another connection', async () => {
    const workspace: string = await openWorkspace();
    const cli: RunLockStore = new RunLockStore({ database: await openDatabase(workspace), isHolderGone: () => false });
    const editor: RunLockStore = new RunLockStore({ database: await openDatabase(workspace), isHolderGone: () => false });

    const first = cli.acquire(cliHolder);
    const second = editor.acquire(editorHolder);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, heldBy: { owner: 'cli', label: 'draft generate', pid: 101 } });
    expect(editor.readHolder()?.owner).toBe('cli');

    if (first.ok) await first.lock.release();
    expect(editor.acquire(editorHolder).ok).toBe(true);
  });

  it('takes over a lock whose heartbeat stopped or whose process is gone', async () => {
    const workspace: string = await openWorkspace();
    const startedAt: Date = new Date('2026-11-11T00:00:00.000Z');
    let now: Date = startedAt;
    const database: CacheDatabase = await openDatabase(workspace);
    const stale = new RunLockStore({ database, now: () => now, isHolderGone: () => false });

    expect(stale.acquire(cliHolder).ok).toBe(true);
    now = new Date(startedAt.getTime() + 46_000);
    expect(stale.readHolder()).toBeUndefined();
    expect(stale.acquire(editorHolder).ok).toBe(true);

    const gone = new RunLockStore({ database, now: () => now, isHolderGone: (record) => record.pid === 202 });
    expect(gone.acquire(cliHolder).ok).toBe(true);
  });

  it('refreshes the heartbeat and releases only its own token', async () => {
    const workspace: string = await openWorkspace();
    let now: Date = new Date('2026-11-11T00:00:00.000Z');
    const store = new RunLockStore({ database: await openDatabase(workspace), now: () => now, isHolderGone: () => false });
    const result = store.acquire(cliHolder);
    if (!result.ok) throw new Error('expected the lock');

    now = new Date('2026-11-11T00:00:30.000Z');
    store.heartbeat(result.lock.record.token);
    store.release('someone-else');
    now = new Date('2026-11-11T00:01:00.000Z');

    expect(store.readHolder()?.heartbeatAt).toBe('2026-11-11T00:00:30.000Z');
    await result.lock.release();
    expect(store.readHolder()).toBeUndefined();
  });
});
