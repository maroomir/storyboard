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
  // Which app this is, as the lock file records it for the others to show.
  readonly owner: WorkspaceRunLockOwner;
}

export type WorkspaceHoldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly heldBy: WorkspaceRunLockRecord; readonly message: string };

// One writer per workspace. Every app takes the same `.storyboard/cache/run.lock` through this gate,
// so the CLI, the desktop app and the extension never rewrite one workspace at once.
export class RunGate {
  public constructor(private readonly deps: RunGateDependencies) {}

  public acquire(workspaceRoot: StoryUri, label: string): Promise<AcquireWorkspaceRunLockResult> {
    return acquireWorkspaceRunLock({
      fileSystem: this.deps.fileSystem,
      workspaceRoot,
      holder: { owner: this.deps.owner, label, pid: process.pid, hostname: hostname() },
    });
  }

  // Who is writing the workspace right now, phrased for the author; undefined when nobody is.
  public async describeHolder(workspaceRoot: StoryUri): Promise<string | undefined> {
    const holder = await readWorkspaceRunLock({ fileSystem: this.deps.fileSystem, workspaceRoot });
    return holder === undefined ? undefined : describeWorkspaceRunLockHolder(holder);
  }

  // Holds the workspace for the duration of `run`. A refusal carries who holds it, phrased for the
  // author; the host adds only its own "try again later" tail.
  public async hold<T>(
    workspaceRoot: StoryUri,
    label: string,
    run: () => Promise<T>,
  ): Promise<WorkspaceHoldResult<T>> {
    const acquired = await this.acquire(workspaceRoot, label);

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
