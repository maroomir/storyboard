import { randomUUID } from 'node:crypto';

import {
  createWorkspaceRunLockRecord,
  isWorkspaceRunLockStale,
  workspaceRunLockOwners,
  workspaceRunLockTiming,
  type WorkspaceRunLockHolder,
  type WorkspaceRunLockOwner,
  type WorkspaceRunLockRecord,
} from '@storyboard/story-model';

import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';
import {
  isHolderGoneFromThisMachine,
  type AcquireWorkspaceRunLockResult,
  type WorkspaceRunLock,
} from '#engine/persistence/workspaceRunLock';

export interface RunLockStoreDependencies {
  readonly database: CacheDatabase;
  readonly now?: () => Date;
  readonly isHolderGone?: (record: WorkspaceRunLockRecord) => boolean;
}

const lockSlot: number = 1;

function isRunLockOwner(value: string): value is WorkspaceRunLockOwner {
  return (workspaceRunLockOwners as readonly string[]).includes(value);
}

function toRunLockRecord(row: SqlRow): WorkspaceRunLockRecord | undefined {
  const owner: string = String(row.owner);
  if (!isRunLockOwner(owner)) {
    return undefined;
  }

  return {
    ...createWorkspaceRunLockRecord(
      { owner, label: String(row.label), pid: Number(row.pid), hostname: String(row.hostname) },
      String(row.token),
      new Date(String(row.acquired_at)),
    ),
    heartbeatAt: String(row.heartbeat_at),
  };
}

export class RunLockStore {
  private readonly now: () => Date;
  private readonly isHolderGone: (record: WorkspaceRunLockRecord) => boolean;

  public constructor(private readonly dependencies: RunLockStoreDependencies) {
    this.now = dependencies.now ?? ((): Date => new Date());
    this.isHolderGone = dependencies.isHolderGone ?? isHolderGoneFromThisMachine;
  }

  public readHolder(): WorkspaceRunLockRecord | undefined {
    const row: SqlRow | undefined = this.dependencies.database.first(
      'SELECT * FROM lock WHERE slot = ?',
      [lockSlot],
    );
    const record: WorkspaceRunLockRecord | undefined =
      row === undefined ? undefined : toRunLockRecord(row);
    const hasLiveHolder: boolean =
      record !== undefined &&
      !isWorkspaceRunLockStale(record, this.now()) &&
      !this.isHolderGone(record);

    return hasLiveHolder ? record : undefined;
  }

  public acquire(holder: WorkspaceRunLockHolder): AcquireWorkspaceRunLockResult {
    return this.dependencies.database.transaction((): AcquireWorkspaceRunLockResult => {
      const existing: WorkspaceRunLockRecord | undefined = this.readHolder();
      if (existing !== undefined) {
        return { ok: false, heldBy: existing };
      }

      const record: WorkspaceRunLockRecord = createWorkspaceRunLockRecord(
        holder,
        randomUUID(),
        this.now(),
      );
      this.writeRecord(record);

      return { ok: true, lock: this.holdLock(record) };
    });
  }

  public heartbeat(token: string): void {
    this.dependencies.database.run(
      'UPDATE lock SET heartbeat_at = ? WHERE slot = ? AND token = ?',
      [this.now().toISOString(), lockSlot, token],
    );
  }

  public release(token: string): void {
    this.dependencies.database.run('DELETE FROM lock WHERE slot = ? AND token = ?', [
      lockSlot,
      token,
    ]);
  }

  private writeRecord(record: WorkspaceRunLockRecord): void {
    this.dependencies.database.run(
      `INSERT OR REPLACE INTO lock (slot, token, owner, label, pid, hostname, acquired_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lockSlot,
        record.token,
        record.owner,
        record.label,
        record.pid,
        record.hostname,
        record.acquiredAt,
        record.heartbeatAt,
      ],
    );
  }

  private holdLock(record: WorkspaceRunLockRecord): WorkspaceRunLock {
    let isReleased: boolean = false;
    const timer: NodeJS.Timeout = setInterval((): void => {
      if (!isReleased) {
        this.heartbeat(record.token);
      }
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
        this.release(record.token);
      },
    };
  }
}
