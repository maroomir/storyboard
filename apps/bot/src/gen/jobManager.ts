import type { IAccessJobStore } from './jobStorePort';
import { JobQueue } from './jobQueue';
import { JobStateMachine } from './jobStateMachine';
import type { JobLog, JobSpec, JobUsage, JobView } from './types';
import { buildTargetKey } from './types';

export class DuplicateJobError extends Error {
  public constructor(public readonly existingJobId: number) {
    super(`active job already exists: ${existingJobId}`);
    this.name = 'DuplicateJobError';
  }
}

export interface IEnqueueJob {
  enqueue(spec: JobSpec): number;
  getStatus(jobId?: number): JobView | JobView[] | undefined;
  getRecent(limit: number): JobView[];
  getLog(jobId: number): JobLog;
  cancel(jobId: number): boolean;
  getUsageSince(since: number): JobUsage;
}

export interface JobManagerOptions {
  readonly store: IAccessJobStore;
  readonly queue: JobQueue;
  readonly stateMachine: JobStateMachine;
  readonly now?: () => number;
  readonly onCancelRunning?: (jobId: number) => void;
}

export class JobManager implements IEnqueueJob {
  private readonly now: () => number;
  private readonly cancelledRunning = new Set<number>();

  public constructor(private readonly options: JobManagerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  public enqueue(spec: JobSpec): number {
    const targetKey = buildTargetKey(spec.target);
    const active = this.options.store.findActiveByTarget(targetKey);
    if (active) {
      throw new DuplicateJobError(active.id);
    }

    const job = this.options.store.insert(spec, this.now());
    return job.id;
  }

  public getStatus(jobId?: number): JobView | JobView[] | undefined {
    if (jobId === undefined) {
      return this.options.store.listRecent(5).map((job) => ({ job }));
    }

    const job = this.options.store.load(jobId);
    return job ? { job } : undefined;
  }

  public getRecent(limit: number): JobView[] {
    return this.options.store.listRecent(limit).map((job) => ({ job }));
  }

  public getLog(jobId: number): JobLog {
    return this.options.store.getLog(jobId);
  }

  public cancel(jobId: number): boolean {
    const job = this.options.store.load(jobId);
    if (!job) {
      return false;
    }

    if (job.state === 'queued') {
      this.options.stateMachine.assertAllowed(job.state, 'cancelled');
      this.options.store.updateState(jobId, {
        state: 'cancelled',
        finishedAt: this.now(),
      });
      return true;
    }

    if (job.state === 'running') {
      this.cancelledRunning.add(jobId);
      this.options.onCancelRunning?.(jobId);
      return true;
    }

    return false;
  }

  public getUsageSince(since: number): JobUsage {
    return this.options.store.sumUsageSince(since);
  }

  public isCancelled(jobId: number): boolean {
    return this.cancelledRunning.has(jobId);
  }

  public clearCancellation(jobId: number): void {
    this.cancelledRunning.delete(jobId);
  }

  public markRunningCancelled(jobId: number): void {
    const job = this.options.store.load(jobId);
    if (!job || job.state !== 'running') {
      return;
    }

    this.options.stateMachine.assertAllowed(job.state, 'cancelled');
    this.options.store.updateState(jobId, {
      state: 'cancelled',
      failureReason: 'cancelled',
      finishedAt: this.now(),
    });
    this.clearCancellation(jobId);
  }
}
