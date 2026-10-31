import { z } from 'zod';

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

interface WorkspaceRunLock {
  version: 1;
  token: string;
  owner: WorkspaceRunLockOwner;
  label: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}

const workspaceRunLockSchema: z.ZodType<WorkspaceRunLock> = z.object({
  version: z.literal(workspaceRunLockVersion),
  token: z.string().min(1),
  owner: z.enum(workspaceRunLockOwners),
  label: z.string(),
  pid: z.number().int(),
  hostname: z.string(),
  acquiredAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
});

export function parseWorkspaceRunLock(raw: string): WorkspaceRunLockRecord | undefined {
  try {
    const parsed: z.ZodSafeParseResult<WorkspaceRunLock> = workspaceRunLockSchema.safeParse(
      JSON.parse(raw),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function serializeWorkspaceRunLock(record: WorkspaceRunLockRecord): string {
  return `${JSON.stringify(workspaceRunLockSchema.parse(record), null, 2)}\n`;
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
