import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { ISqlDatabase, ISqlDatabaseHost, SqlRow, SqlValue } from '@storyboard/story-engine';
import type { StoryUri } from '@storyboard/story-model';

type SqliteModule = typeof import('node-sqlite3-wasm');

type WasmDatabase = InstanceType<SqliteModule['Database']>;

interface LoadedSqliteModule {
  readonly default?: SqliteModule;
  readonly Database?: SqliteModule['Database'];
}

const orphanedDatabaseLockAgeMs: number = 60_000;

const databaseLockSuffix: string = '.lock';

async function loadDatabaseClass(): Promise<SqliteModule['Database']> {
  const loaded: LoadedSqliteModule = (await import('node-sqlite3-wasm')) as LoadedSqliteModule;
  const databaseClass: SqliteModule['Database'] | undefined =
    loaded.Database ?? loaded.default?.Database;
  if (databaseClass === undefined) {
    throw new Error('node-sqlite3-wasm 에서 Database 를 찾을 수 없습니다.');
  }

  return databaseClass;
}

async function removeOrphanedDatabaseLock(databasePath: string): Promise<void> {
  const lockPath: string = `${databasePath}${databaseLockSuffix}`;
  try {
    const lockAgeMs: number = Date.now() - (await fs.stat(lockPath)).mtimeMs;
    if (lockAgeMs > orphanedDatabaseLockAgeMs) {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  } catch {
    return;
  }
}

function toSqlValue(value: unknown): SqlValue {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function toSqlRow(row: Record<string, unknown>): SqlRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toSqlValue(value)]));
}

class NodeSqlDatabase implements ISqlDatabase {
  public constructor(private readonly database: WasmDatabase) {}

  public execute(sql: string): void {
    this.database.exec(sql);
  }

  public run(sql: string, parameters: readonly SqlValue[] = []): void {
    this.database.run(sql, [...parameters]);
  }

  public all(sql: string, parameters: readonly SqlValue[] = []): readonly SqlRow[] {
    return this.database.all(sql, [...parameters]).map((row) => toSqlRow(row));
  }

  public close(): void {
    this.database.close();
  }
}

export class NodeSqlDatabaseHost implements ISqlDatabaseHost {
  public async open(uri: StoryUri): Promise<ISqlDatabase> {
    const databasePath: string = uri.fsPath;
    await fs.mkdir(dirname(databasePath), { recursive: true });
    await removeOrphanedDatabaseLock(databasePath);
    const databaseClass: SqliteModule['Database'] = await loadDatabaseClass();

    return new NodeSqlDatabase(new databaseClass(databasePath));
  }
}
