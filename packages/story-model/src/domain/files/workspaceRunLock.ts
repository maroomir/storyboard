import { z } from 'zod';

const workspaceRunLockVersion = 1 as const;

export const workspaceRunLockOwners = ['cli', 'desktop', 'vscode'] as const;
export type WorkspaceRunLockOwner = (typeof workspaceRunLockOwners)[number];

// NOTE: 잠금을 쥔 앱이 죽으면 파일이 남는다. 쥔 쪽이 주기적으로 heartbeatAt 을 갱신하고, 그 갱신이
// 끊긴 지 staleAfterMs 가 지난 잠금은 버려진 것으로 본다. pid 로 생사를 묻지 않는 이유는 동기화
// 폴더처럼 다른 기기의 프로세스가 쥔 잠금도 같은 규칙으로 풀려야 하기 때문이다.
export const workspaceRunLockTiming = {
  heartbeatIntervalMs: 10_000,
  staleAfterMs: 45_000,
} as const;

export interface WorkspaceRunLockHolder {
  readonly owner: WorkspaceRunLockOwner;
  // 무엇을 하느라 잠갔는지. 다른 앱이 거절 메시지에 그대로 보여 준다.
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

const workspaceRunLockSchema = z.object({
  version: z.literal(workspaceRunLockVersion),
  token: z.string().min(1),
  owner: z.enum(workspaceRunLockOwners),
  label: z.string(),
  pid: z.number().int(),
  hostname: z.string(),
  acquiredAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
});

// A lock file that does not parse was not written by a live holder of this version, so it guards
// nothing: undefined lets the caller take the workspace instead of being blocked forever by it.
export function parseWorkspaceRunLock(raw: string): WorkspaceRunLockRecord | undefined {
  try {
    const parsed = workspaceRunLockSchema.safeParse(JSON.parse(raw));
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
  const timestamp = now.toISOString();

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
    desktop: '데스크톱 앱',
    vscode: 'VSCode 확장',
  };

  return `${appLabel[record.owner]}이(가) «${record.label}» 작업 중입니다`;
}
