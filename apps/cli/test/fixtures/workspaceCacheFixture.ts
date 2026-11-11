import { WorkspaceCaches, WorkspaceRunLocks } from '@storyboard/story-engine';
import {
  createWorkspaceRunLockRecord,
  NodeUri,
  type WorkspaceRunLockHolder,
  type WorkspaceRunLockRecord,
} from '@storyboard/story-model';
import { NodeFileSystem, NodeSqlDatabaseHost } from '@storyboard/story-node';

export function createWorkspaceCaches(): WorkspaceCaches {
  return new WorkspaceCaches({ host: new NodeSqlDatabaseHost(), fileSystem: new NodeFileSystem() });
}

export function createWorkspaceRunLocks(
  caches: WorkspaceCaches,
  now?: () => Date,
): WorkspaceRunLocks {
  return new WorkspaceRunLocks({ caches, ...(now === undefined ? {} : { now }) });
}

export async function plantRunLock(
  caches: WorkspaceCaches,
  workspace: string,
  holder: WorkspaceRunLockHolder,
  heartbeatAt: Date,
  token: string = 'extension-token',
): Promise<WorkspaceRunLockRecord> {
  const record: WorkspaceRunLockRecord = createWorkspaceRunLockRecord(holder, token, heartbeatAt);
  const database = await caches.open(NodeUri.file(workspace));
  database.run(
    `INSERT OR REPLACE INTO lock (slot, token, owner, label, pid, hostname, acquired_at, heartbeat_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.token,
      record.owner,
      record.label,
      record.pid,
      record.hostname,
      record.acquiredAt,
      record.heartbeatAt,
    ],
  );
  return record;
}

export async function readRunLockToken(
  caches: WorkspaceCaches,
  workspace: string,
): Promise<string | undefined> {
  const database = await caches.open(NodeUri.file(workspace));
  const row = database.first('SELECT token FROM lock WHERE slot = 1');
  return row === undefined ? undefined : String(row.token);
}
