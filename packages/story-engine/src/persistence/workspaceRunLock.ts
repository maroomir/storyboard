import type {
  StoryUri,
  WorkspaceRunLockHolder,
  WorkspaceRunLockRecord,
} from '@storyboard/story-model';

import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';
import {
  RunLockStore,
  type AcquireWorkspaceRunLockResult,
} from '#engine/persistence/cache/runLockStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface WorkspaceRunLocksDependencies {
  readonly caches: WorkspaceCaches;
  readonly now?: () => Date;
  readonly isHolderGone?: (record: WorkspaceRunLockRecord) => boolean;
}

export class WorkspaceRunLocks {
  public constructor(private readonly dependencies: WorkspaceRunLocksDependencies) {}

  public async readHolder(workspaceRoot: StoryUri): Promise<WorkspaceRunLockRecord | undefined> {
    return (await this.openStore(workspaceRoot)).readHolder();
  }

  public async acquire(
    workspaceRoot: StoryUri,
    holder: WorkspaceRunLockHolder,
  ): Promise<AcquireWorkspaceRunLockResult> {
    return (await this.openStore(workspaceRoot)).acquire(holder);
  }

  private async openStore(workspaceRoot: StoryUri): Promise<RunLockStore> {
    const database: CacheDatabase = await this.dependencies.caches.open(workspaceRoot);

    return new RunLockStore({
      database,
      ...(this.dependencies.now === undefined ? {} : { now: this.dependencies.now }),
      ...(this.dependencies.isHolderGone === undefined
        ? {}
        : { isHolderGone: this.dependencies.isHolderGone }),
    });
  }
}
