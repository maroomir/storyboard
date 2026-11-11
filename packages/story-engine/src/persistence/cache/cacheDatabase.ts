import {
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISqlDatabase, ISqlDatabaseHost, SqlRow, SqlValue } from '#engine/ports/sqlDatabase';
import {
  cacheDatabaseSchemaVersion,
  cacheTableDefinitions,
  cacheTableNames,
} from '#engine/persistence/cache/cacheDatabaseSchema';

export interface CacheDatabaseOpenRequest {
  readonly host: ISqlDatabaseHost;
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
}

export interface CacheDatabaseOpening {
  readonly database: CacheDatabase;
  readonly wasRebuilt: boolean;
}

const sqliteInternalTablePrefix: string = 'sqlite_';

export class CacheDatabase {
  private constructor(private readonly database: ISqlDatabase) {}

  public static async open(request: CacheDatabaseOpenRequest): Promise<CacheDatabaseOpening> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    await request.fileSystem.createDirectory(paths.cacheDirectory);
    const cacheDatabase: CacheDatabase = new CacheDatabase(
      await request.host.open(paths.cacheDatabase),
    );

    return { database: cacheDatabase, wasRebuilt: cacheDatabase.ensureSchema() };
  }

  public run(sql: string, parameters: readonly SqlValue[] = []): void {
    this.database.run(sql, parameters);
  }

  public all(sql: string, parameters: readonly SqlValue[] = []): readonly SqlRow[] {
    return this.database.all(sql, parameters);
  }

  public first(sql: string, parameters: readonly SqlValue[] = []): SqlRow | undefined {
    return this.database.all(sql, parameters)[0];
  }

  public transaction<T>(work: () => T): T {
    this.database.execute('BEGIN IMMEDIATE');
    try {
      const result: T = work();
      this.database.execute('COMMIT');
      return result;
    } catch (error) {
      this.database.execute('ROLLBACK');
      throw error;
    }
  }

  public listTableNames(): readonly string[] {
    return this.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((row) => String(row.name))
      .filter((name) => !name.startsWith(sqliteInternalTablePrefix));
  }

  public readSchemaVersion(): number {
    return Number(this.first('PRAGMA user_version')?.user_version ?? 0);
  }

  public close(): void {
    this.database.close();
  }

  private ensureSchema(): boolean {
    const existingTables: readonly string[] = this.listTableNames();
    const hasCurrentSchema: boolean =
      this.readSchemaVersion() === cacheDatabaseSchemaVersion &&
      cacheTableNames.every((name) => existingTables.includes(name));
    if (hasCurrentSchema) {
      return false;
    }

    this.transaction((): void => {
      for (const name of existingTables) {
        this.database.execute(`DROP TABLE IF EXISTS "${name}"`);
      }
      for (const name of cacheTableNames) {
        cacheTableDefinitions[name].forEach((statement) => this.database.execute(statement));
      }
      this.database.execute(`PRAGMA user_version = ${cacheDatabaseSchemaVersion}`);
    });

    return existingTables.length > 0;
  }
}
