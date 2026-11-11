import type { StoryUri } from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISqlDatabaseHost } from '#engine/ports/sqlDatabase';
import { CacheDatabase, type CacheDatabaseOpening } from '#engine/persistence/cache/cacheDatabase';

export interface WorkspaceCachesDependencies {
  readonly host: ISqlDatabaseHost;
  readonly fileSystem: IFileSystem;
}

export class WorkspaceCaches {
  private readonly openings: Map<string, Promise<CacheDatabase>> = new Map();

  public constructor(private readonly dependencies: WorkspaceCachesDependencies) {}

  public open(workspaceRoot: StoryUri): Promise<CacheDatabase> {
    const key: string = workspaceRoot.toString();
    const opened: Promise<CacheDatabase> | undefined = this.openings.get(key);
    if (opened !== undefined) {
      return opened;
    }

    const opening: Promise<CacheDatabase> = this.openDatabase(workspaceRoot);
    this.openings.set(key, opening);
    opening.catch((): void => {
      this.openings.delete(key);
    });
    return opening;
  }

  public async closeAll(): Promise<void> {
    const openings: readonly Promise<CacheDatabase>[] = [...this.openings.values()];
    this.openings.clear();

    for (const opening of openings) {
      try {
        (await opening).close();
      } catch {
        continue;
      }
    }
  }

  private async openDatabase(workspaceRoot: StoryUri): Promise<CacheDatabase> {
    const opened: CacheDatabaseOpening = await CacheDatabase.open({
      host: this.dependencies.host,
      fileSystem: this.dependencies.fileSystem,
      workspaceRoot,
    });

    return opened.database;
  }
}
