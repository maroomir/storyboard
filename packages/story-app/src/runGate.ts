import { hostname } from 'node:os';

import {
  acquireWorkspaceRunLock,
  readWorkspaceRunLock,
  type AcquireWorkspaceRunLockResult,
  type IFileSystem,
} from '@storyboard/story-engine';
import {
  describeWorkspaceRunLockHolder,
  type WorkspaceRunLockOwner,
  type WorkspaceRunLockRecord,
} from '@storyboard/story-model';
import type { StoryUri } from '@storyboard/story-model';

export interface RunGateDependencies {
  readonly fileSystem: IFileSystem;
  readonly owner: WorkspaceRunLockOwner;
}

export type WorkspaceHoldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly heldBy: WorkspaceRunLockRecord; readonly message: string };

export class RunGate {
  public constructor(private readonly deps: RunGateDependencies) {}

  private acquire(workspaceRoot: StoryUri, label: string): Promise<AcquireWorkspaceRunLockResult> {
    return acquireWorkspaceRunLock({
      fileSystem: this.deps.fileSystem,
      workspaceRoot,
      holder: { owner: this.deps.owner, label, pid: process.pid, hostname: hostname() },
    });
  }

  public async describeHolder(workspaceRoot: StoryUri): Promise<string | undefined> {
    const holder: WorkspaceRunLockRecord | undefined = await readWorkspaceRunLock({
      fileSystem: this.deps.fileSystem,
      workspaceRoot,
    });
    return holder === undefined ? undefined : describeWorkspaceRunLockHolder(holder);
  }

  public async hold<T>(
    workspaceRoot: StoryUri,
    label: string,
    run: () => Promise<T>,
  ): Promise<WorkspaceHoldResult<T>> {
    const acquired: AcquireWorkspaceRunLockResult = await this.acquire(workspaceRoot, label);

    if (!acquired.ok) {
      return {
        ok: false,
        heldBy: acquired.heldBy,
        message: describeWorkspaceRunLockHolder(acquired.heldBy),
      };
    }

    try {
      return { ok: true, value: await run() };
    } finally {
      await acquired.lock.release();
    }
  }
}
