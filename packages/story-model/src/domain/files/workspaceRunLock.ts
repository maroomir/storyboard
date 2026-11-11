type WorkspaceRunLockVersion = 1;

const workspaceRunLockVersion: WorkspaceRunLockVersion = 1;

export type WorkspaceRunLockOwner = 'cli' | 'vscode';

export const workspaceRunLockOwners: readonly [WorkspaceRunLockOwner, ...WorkspaceRunLockOwner[]] =
  ['cli', 'vscode'];

interface WorkspaceRunLockTiming {
  readonly heartbeatIntervalMs: number;
  readonly staleAfterMs: number;
}

export const workspaceRunLockTiming: WorkspaceRunLockTiming = {
  heartbeatIntervalMs: 10_000,
  staleAfterMs: 45_000,
};

export interface WorkspaceRunLockHolder {
  readonly owner: WorkspaceRunLockOwner;
  readonly label: string;
  readonly pid: number;
  readonly hostname: string;
}

export interface WorkspaceRunLockRecord extends WorkspaceRunLockHolder {
  readonly version: typeof workspaceRunLockVersion;
  readonly token: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
}

export function createWorkspaceRunLockRecord(
  holder: WorkspaceRunLockHolder,
  token: string,
  now: Date,
): WorkspaceRunLockRecord {
  const timestamp: string = now.toISOString();

  return {
    version: workspaceRunLockVersion,
    token,
    ...holder,
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
  };
}

export function isWorkspaceRunLockStale(record: WorkspaceRunLockRecord, now: Date): boolean {
  return now.getTime() - Date.parse(record.heartbeatAt) > workspaceRunLockTiming.staleAfterMs;
}

export function describeWorkspaceRunLockHolder(record: WorkspaceRunLockHolder): string {
  const appLabel: Record<WorkspaceRunLockOwner, string> = {
    cli: 'CLI',
    vscode: 'VSCode 확장',
  };

  return `${appLabel[record.owner]}이(가) «${record.label}» 작업 중입니다`;
}
