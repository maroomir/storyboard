import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CacheDatabase, cacheDatabaseSchemaVersion, cacheTableNames } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';

const workspaces: string[] = [];

function createWorkspace(): string {
  const workspace: string = mkdtempSync(join(tmpdir(), 'storyboard-cache-'));
  workspaces.push(workspace);
  return workspace;
}

async function openCache(workspace: string): Promise<Awaited<ReturnType<typeof CacheDatabase.open>>> {
  return await CacheDatabase.open({
    host: new NodeSqlDatabaseHost(),
    fileSystem: new NodeFileSystem(),
    workspaceRoot: NodeUri.file(workspace),
  });
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe('cache database', () => {
  it('creates the nine tables in .storyboard/cache/storyboard.db with its schema version', async () => {
    const workspace: string = createWorkspace();
    const { database, wasRebuilt } = await openCache(workspace);

    expect(wasRebuilt).toBe(false);
    expect([...database.listTableNames()].sort()).toEqual([...cacheTableNames].sort());
    expect(database.readSchemaVersion()).toBe(cacheDatabaseSchemaVersion);
    database.close();
    expect(existsSync(join(workspace, '.storyboard', 'cache', 'storyboard.db'))).toBe(true);
  });

  it('keeps what it holds across openings', async () => {
    const workspace: string = createWorkspace();
    const first = await openCache(workspace);
    first.database.run('INSERT INTO revision_plans (id, created_at, data) VALUES (?, ?, ?)', ['p1', '2026-11-11T00:00:00.000Z', '{}']);
    first.database.close();

    const second = await openCache(workspace);

    expect(second.wasRebuilt).toBe(false);
    expect(second.database.all('SELECT id FROM revision_plans')).toEqual([{ id: 'p1' }]);
    second.database.close();
  });

  it('throws the database away and builds it again when the schema version does not match', async () => {
    const workspace: string = createWorkspace();
    const first = await openCache(workspace);
    first.database.run('INSERT INTO revision_plans (id, created_at, data) VALUES (?, ?, ?)', ['p1', '2026-11-11T00:00:00.000Z', '{}']);
    first.database.run('CREATE TABLE leftover (a TEXT)');
    first.database.run('PRAGMA user_version = 99');
    first.database.close();

    const second = await openCache(workspace);

    expect(second.wasRebuilt).toBe(true);
    expect(second.database.listTableNames()).not.toContain('leftover');
    expect(second.database.all('SELECT id FROM revision_plans')).toEqual([]);
    expect(second.database.readSchemaVersion()).toBe(cacheDatabaseSchemaVersion);
    second.database.close();
  });

  it('rolls a failed transaction back', async () => {
    const { database } = await openCache(createWorkspace());

    expect(() =>
      database.transaction((): void => {
        database.run('INSERT INTO revision_plans (id, created_at, data) VALUES (?, ?, ?)', ['p1', 'now', '{}']);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(database.all('SELECT id FROM revision_plans')).toEqual([]);
    database.close();
  });
});
