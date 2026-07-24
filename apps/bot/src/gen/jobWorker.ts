import type { JobExecutor } from './jobExecutor';
import { JobQueue } from './jobQueue';
import type { GenJob, JobClass, JobsConfig } from './types';

export interface JobWorkerOptions {
  readonly queue: JobQueue;
  readonly executor: JobExecutor;
  readonly jobsConfig: JobsConfig;
  readonly pollIntervalMs?: number;
}

// Owns concurrency and polling: one loop per configured slot in each job class pulls the next job
// and hands it to the JobExecutor, bounded by the class concurrency limit. Single-job state
// transitions live in JobExecutor.
export class JobWorker {
  private running = false;
  private readonly activeByClass = new Map<JobClass, number>([
    ['heavy', 0],
    ['light', 0],
  ]);
  private readonly inFlight = new Set<Promise<void>>();

  private readonly pollIntervalMs: number;

  public constructor(private readonly options: JobWorkerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.spawnLoops('heavy', this.options.jobsConfig.heavyConcurrency);
    this.spawnLoops('light', this.options.jobsConfig.lightConcurrency);
  }

  public async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.inFlight]);
  }

  private spawnLoops(jobClass: JobClass, concurrency: number): void {
    for (let slot = 0; slot < concurrency; slot += 1) {
      void this.runLoop(jobClass);
    }
  }

  private async runLoop(jobClass: JobClass): Promise<void> {
    while (this.running) {
      const active = this.activeByClass.get(jobClass) ?? 0;
      const limit =
        jobClass === 'heavy'
          ? this.options.jobsConfig.heavyConcurrency
          : this.options.jobsConfig.lightConcurrency;

      if (active >= limit) {
        await delay(this.pollIntervalMs);
        continue;
      }

      const job = this.options.queue.takeNext(jobClass);
      if (!job) {
        await delay(this.pollIntervalMs);
        continue;
      }

      const task = this.executeJob(job);
      this.inFlight.add(task);
      void task.finally(() => this.inFlight.delete(task));
    }
  }

  private async executeJob(job: GenJob): Promise<void> {
    this.activeByClass.set(job.class, (this.activeByClass.get(job.class) ?? 0) + 1);
    try {
      await this.options.executor.execute(job);
    } finally {
      this.activeByClass.set(job.class, Math.max(0, (this.activeByClass.get(job.class) ?? 1) - 1));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
