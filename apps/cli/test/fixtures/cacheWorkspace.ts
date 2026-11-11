import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CacheDatabase } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';

export class TemporaryWorkspaces {
  private readonly directories: string[] = [];
  private readonly databases: CacheDatabase[] = [];

  public create(prefix: string = 'storyboard-'): string {
    const directory: string = mkdtempSync(join(tmpdir(), prefix));
    this.directories.push(directory);
    return directory;
  }

  public async openCache(workspace: string): Promise<CacheDatabase> {
    const { database } = await CacheDatabase.open({
      host: new NodeSqlDatabaseHost(),
      fileSystem: new NodeFileSystem(),
      workspaceRoot: NodeUri.file(workspace),
    });
    this.databases.push(database);
    return database;
  }

  public async openFreshCache(): Promise<CacheDatabase> {
    return await this.openCache(this.create());
  }

  public cleanUp(): void {
    this.databases.splice(0).forEach((database) => database.close());
    this.directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  }
}
