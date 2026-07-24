import type {
  FailureReason,
  GenJob,
  JobLog,
  JobLogEntry,
  JobSpec,
  JobState,
  JobUsage,
} from './types';

// The job-store contract, owned by the generation core. The SQLite adapter (store/sqliteJobStore)
// implements it, so gen depends on this port rather than on the concrete store.
export interface StateTransition {
  readonly state: JobState;
  readonly failureReason?: FailureReason;
  readonly startedAt?: number | null;
  readonly finishedAt?: number | null;
  readonly resultRef?: string | null;
  readonly progressMessageId?: number | null;
  readonly usage?: JobUsage;
}

export interface UsageLedgerEntry {
  readonly jobId: number;
  readonly taskName: string;
  readonly providerId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly recordedAt: number;
}

export interface IAccessJobStore {
  insert(spec: JobSpec, now: number): GenJob;
  updateState(jobId: number, transition: StateTransition): GenJob;
  load(jobId: number): GenJob | undefined;
  loadByState(state: JobState): GenJob[];
  findActiveByTarget(targetKey: string): GenJob | undefined;
  listRecent(limit: number): GenJob[];
  recordUsage(entry: Omit<UsageLedgerEntry, 'recordedAt'>, recordedAt: number): void;
  appendLog(jobId: number, entry: Omit<JobLogEntry, 'at'>, at: number): void;
  getLog(jobId: number): JobLog;
  sumUsageSince(since: number): JobUsage;
}
