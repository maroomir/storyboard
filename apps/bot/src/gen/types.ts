export type JobKind = 'draft' | 'review' | 'suggest' | 'outline' | 'plan' | 'manuscript';
export type JobClass = 'heavy' | 'light';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
export type FailureReason =
  | 'timeout'
  | 'rate_limit'
  | 'not_installed'
  | 'provider_error'
  | 'cancelled'
  | null;

export interface JobTarget {
  readonly scene?: string;
  readonly [key: string]: unknown;
}

export interface JobUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  // True when some of these tokens came from a provider with no price table, so `costUsd` is a
  // floor rather than the whole bill.
  readonly hasUnpricedUsage?: boolean;
}

export interface GenJob {
  readonly id: number;
  readonly kind: JobKind;
  readonly class: JobClass;
  readonly target: JobTarget;
  readonly targetKey: string;
  readonly options: Record<string, unknown>;
  readonly state: JobState;
  readonly failureReason: FailureReason;
  readonly provider: Record<string, unknown>;
  readonly chatId: number;
  readonly progressMessageId: number | null;
  readonly usage: JobUsage;
  readonly resultRef: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export interface JobSpec {
  readonly kind: JobKind;
  readonly class: JobClass;
  readonly target: JobTarget;
  readonly options?: Record<string, unknown>;
  readonly provider?: Record<string, unknown>;
  readonly chatId: number;
}

export interface JobLogEntry {
  readonly at: number;
  readonly level: 'info' | 'error';
  readonly stage: string;
  readonly message: string;
}

export interface JobLog {
  readonly jobId: number;
  readonly entries: readonly JobLogEntry[];
}

export interface JobView {
  readonly job: GenJob;
}

export interface PipelineResult {
  readonly success: boolean;
  readonly resultRef?: string;
  readonly usage?: JobUsage;
  readonly failureReason?: FailureReason;
  readonly errorMessage?: string;
}

export interface JobsConfig {
  readonly heavyConcurrency: number;
  readonly lightConcurrency: number;
}

export const EMPTY_JOB_USAGE: JobUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

// Never print a bare dollar figure for a total that has unpriced tokens in it: it reads as the
// whole bill when it is only the part that had a price list.
export function formatJobUsage(usage: JobUsage): string {
  const tokens = `입력 ${usage.inputTokens.toLocaleString()} · 출력 ${usage.outputTokens.toLocaleString()} 토큰`;
  const cost =
    usage.hasUnpricedUsage === true
      ? `$${usage.costUsd.toFixed(4)} (구독 CLI 사용량 제외)`
      : `$${usage.costUsd.toFixed(4)}`;

  return `${tokens} · ${cost}`;
}

export function buildTargetKey(target: JobTarget): string {
  if (typeof target.scene === 'string' && target.scene.length > 0) {
    return `scene:${target.scene}`;
  }

  return `target:${stableJson(target)}`;
}

export function defaultJobClass(kind: JobKind): JobClass {
  return kind === 'suggest' ? 'light' : 'heavy';
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
