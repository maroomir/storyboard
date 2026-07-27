import type { IAccessJobStore } from './jobStorePort';
import { JobAbortedError } from '../provider/abortableCliRunner';
import type { IJobProgressListener } from './progress';
import { NullProgressListener } from './progress';
import type { GenJob, PipelineResult } from './types';

export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface PipelineContext {
  readonly isCancelled: () => boolean;
  readonly log: (stage: string, message: string, level?: 'info' | 'error') => void;
  readonly reportStage: (stage: string) => Promise<void>;
}

export interface IPipeline {
  run(job: GenJob, context: PipelineContext): Promise<PipelineResult>;
}

export interface PipelineRunnerOptions {
  readonly store: IAccessJobStore;
  readonly pipeline: IPipeline;
  readonly createListeners?: (job: GenJob) => readonly IJobProgressListener[];
  readonly now?: () => number;
}

export class PipelineRunner {
  private readonly now: () => number;

  public constructor(private readonly options: PipelineRunnerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  public async run(job: GenJob, isCancelled: () => boolean): Promise<PipelineResult> {
    const listeners = this.options.createListeners?.(job) ?? [new NullProgressListener()];
    const startedAt = this.now();
    const originStartedAt = job.startedAt ?? job.createdAt;

    await Promise.all(listeners.map((listener) => listener.onJobStarted(job)));

    const heartbeatTimer = setInterval(() => {
      const elapsedMs = this.now() - originStartedAt;
      void Promise.all(listeners.map((listener) => listener.onHeartbeat(job, elapsedMs)));
    }, HEARTBEAT_INTERVAL_MS);

    const context: PipelineContext = {
      isCancelled,
      log: (stage, message, level = 'info') => {
        this.options.store.appendLog(job.id, { stage, message, level }, this.now());
      },
      reportStage: async (stage) => {
        await notifyStage(listeners, job, stage);
      },
    };

    try {
      const result = await this.options.pipeline.run(job, context);
      await Promise.all(listeners.map((listener) => listener.onFinished(job, result)));
      return result;
    } catch (error) {
      if (isCancelled() || error instanceof JobAbortedError) {
        const cancelled: PipelineResult = {
          success: false,
          failureReason: 'cancelled',
          errorMessage: 'cancelled by user',
        };
        await Promise.all(listeners.map((listener) => listener.onFinished(job, cancelled)));
        return cancelled;
      }

      const message = error instanceof Error ? error.message : String(error);
      context.log('error', message, 'error');

      const failure: PipelineResult = {
        success: false,
        failureReason: 'provider_error',
        errorMessage: message,
      };
      await Promise.all(listeners.map((listener) => listener.onFinished(job, failure)));
      return failure;
    } finally {
      clearInterval(heartbeatTimer);
      void startedAt;
    }
  }
}

async function notifyStage(
  listeners: readonly IJobProgressListener[],
  job: GenJob,
  stage: string,
): Promise<void> {
  await Promise.all(listeners.map((listener) => listener.onStage(job, stage)));
}
