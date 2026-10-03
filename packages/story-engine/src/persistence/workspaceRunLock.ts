import { randomUUID } from 'node:crypto';

import type { StoryUri } from '@storyboard/story-model';
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

// The live holder of a workspace, if any. A stale or unreadable lock counts as nobody.
export async function readWorkspaceRunLock(
  options: WorkspaceRunLockOptions,
): Promise<WorkspaceRunLockRecord | undefined> {
  const now = options.now ?? ((): Date => new Date());
  const lockUri = getStoryboardProjectPaths(options.workspaceRoot).runLock;
  const record = await readLockFile(options.fileSystem, lockUri);

  return record === undefined || isWorkspaceRunLockStale(record, now()) ? undefined : record;
}

// NOTE: 파일 쓰기에는 «없을 때만 만들기»가 없어서, 쓰고 나서 다시 읽어 내 토큰이 남아 있는지로
// 이겼는지를 판정한다. 두 앱이 같은 순간에 쓰면 나중에 쓴 쪽만 남고, 먼저 쓴 쪽은 다시 읽을 때
// 남의 토큰을 보고 물러난다.
export async function acquireWorkspaceRunLock(
  options: WorkspaceRunLockOptions & { readonly holder: WorkspaceRunLockHolder },
): Promise<AcquireWorkspaceRunLockResult> {
  const { fileSystem } = options;
  const now = options.now ?? ((): Date => new Date());
  const paths = getStoryboardProjectPaths(options.workspaceRoot);
  const existing = await readWorkspaceRunLock(options);

  if (existing !== undefined) {
    return { ok: false, heldBy: existing };
  }

  const record = createWorkspaceRunLockRecord(options.holder, randomUUID(), now());

  await fileSystem.createDirectory(paths.cacheDirectory);
  await writeLockFile(fileSystem, paths.runLock, record);

  const winner = await readLockFile(fileSystem, paths.runLock);

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
  let isReleased = false;

  const beat = async (): Promise<void> => {
    const current = await readLockFile(fileSystem, lockUri);

    if (isReleased || current?.token !== record.token) {
      return;
    }

    await writeLockFile(fileSystem, lockUri, { ...record, heartbeatAt: now().toISOString() });
  };

  // NOTE: 박동 한 번을 놓쳐도 잠금이 곧바로 풀리지는 않는다(staleAfterMs 가 간격의 몇 배다).
  // 여기서 실패를 던지면 잠금을 쥔 생성 작업 전체가 죽으므로 삼킨다.
  const timer = setInterval(() => {
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

      const current = await readLockFile(fileSystem, lockUri);

      if (current?.token === record.token) {
        await fileSystem.delete(lockUri);
      }
    },
  };
}
