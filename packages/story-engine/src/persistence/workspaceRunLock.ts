import { randomUUID } from 'node:crypto';

import type { StoryboardProjectPaths, StoryUri } from '@storyboard/story-model';
import {
  createWorkspaceRunLockRecord,
  isWorkspaceRunLockStale,
  parseWorkspaceRunLock,
  serializeWorkspaceRunLock,
  workspaceRunLockTiming,
  type WorkspaceRunLockHolder,
  type WorkspaceRunLockRecord,
  getStoryboardProjectPaths,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface WorkspaceRunLock {
  readonly record: WorkspaceRunLockRecord;
  release(): Promise<void>;
}

export type AcquireWorkspaceRunLockResult =
  | { readonly ok: true; readonly lock: WorkspaceRunLock }
  | { readonly ok: false; readonly heldBy: WorkspaceRunLockRecord };

export interface WorkspaceRunLockOptions {
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
  readonly now?: () => Date;
}

async function readLockFile(
  fileSystem: IFileSystem,
  lockUri: StoryUri,
): Promise<WorkspaceRunLockRecord | undefined> {
  if (!(await fileSystem.exists(lockUri))) {
    return undefined;
  }

  return parseWorkspaceRunLock(new TextDecoder().decode(await fileSystem.readFile(lockUri)));
}

async function writeLockFile(
  fileSystem: IFileSystem,
  lockUri: StoryUri,
  record: WorkspaceRunLockRecord,
): Promise<void> {
  await fileSystem.writeFile(lockUri, new TextEncoder().encode(serializeWorkspaceRunLock(record)));
}

export async function readWorkspaceRunLock(
  options: WorkspaceRunLockOptions,
): Promise<WorkspaceRunLockRecord | undefined> {
  const now: () => Date = options.now ?? ((): Date => new Date());
  const lockUri: StoryUri = getStoryboardProjectPaths(options.workspaceRoot).runLock;
  const record: WorkspaceRunLockRecord | undefined = await readLockFile(
    options.fileSystem,
    lockUri,
  );

  return record === undefined || isWorkspaceRunLockStale(record, now()) ? undefined : record;
}

export async function acquireWorkspaceRunLock(
  options: WorkspaceRunLockOptions & { readonly holder: WorkspaceRunLockHolder },
): Promise<AcquireWorkspaceRunLockResult> {
  const { fileSystem } = options;
  const now: () => Date = options.now ?? ((): Date => new Date());
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(options.workspaceRoot);
  const existing: WorkspaceRunLockRecord | undefined = await readWorkspaceRunLock(options);

  if (existing !== undefined) {
    return { ok: false, heldBy: existing };
  }

  const record: WorkspaceRunLockRecord = createWorkspaceRunLockRecord(
    options.holder,
    randomUUID(),
    now(),
  );

  await fileSystem.createDirectory(paths.cacheDirectory);
  await writeLockFile(fileSystem, paths.runLock, record);

  const winner: WorkspaceRunLockRecord | undefined = await readLockFile(fileSystem, paths.runLock);

  if (winner?.token !== record.token) {
    return winner === undefined ? { ok: false, heldBy: record } : { ok: false, heldBy: winner };
  }

  return { ok: true, lock: holdLock(fileSystem, paths.runLock, record, now) };
}

function holdLock(
  fileSystem: IFileSystem,
  lockUri: StoryUri,
  record: WorkspaceRunLockRecord,
  now: () => Date,
): WorkspaceRunLock {
  let isReleased: boolean = false;

  const beat = async (): Promise<void> => {
    const current: WorkspaceRunLockRecord | undefined = await readLockFile(fileSystem, lockUri);

    if (isReleased || current?.token !== record.token) {
      return;
    }

    await writeLockFile(fileSystem, lockUri, { ...record, heartbeatAt: now().toISOString() });
  };

  const timer: NodeJS.Timeout = setInterval(() => {
    void beat().catch(() => undefined);
  }, workspaceRunLockTiming.heartbeatIntervalMs);
  timer.unref?.();

  return {
    record,
    release: async (): Promise<void> => {
      if (isReleased) {
        return;
      }

      isReleased = true;
      clearInterval(timer);

      const current: WorkspaceRunLockRecord | undefined = await readLockFile(fileSystem, lockUri);

      if (current?.token === record.token) {
        await fileSystem.delete(lockUri);
      }
    },
  };
}
