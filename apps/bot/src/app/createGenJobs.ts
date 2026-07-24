import type { StoryboardAIService } from '@storyboard/story-ai';

import type { ContentService } from '../content/contentService';
import type { ISendMessage } from '../chat/ports';
import type { StorygramDatabase } from '../store/db';
import { TelegramProgressReporter } from '../telegram/jobProgressReporter';
import type { Logger } from '../util/logger';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import { DraftPipeline, type DraftGenerator } from '../gen/draftPipeline';
import { JobExecutor } from '../gen/jobExecutor';
import { JobManager, type IEnqueueJob } from '../gen/jobManager';
import { JobQueue } from '../gen/jobQueue';
import { JobRecoveryService } from '../gen/jobRecovery';
import { JobRunControl } from '../gen/jobRunControl';
import { JobStateMachine } from '../gen/jobStateMachine';
import { SqliteJobStore } from '../gen/jobStore';
import { JobWorker } from '../gen/jobWorker';
import { PipelineRunner } from '../gen/pipelineRunner';
import type { GenJob, JobsConfig } from '../gen/types';
import {
  KindDispatchPipeline,
  ManuscriptPipeline,
  OutlinePipeline,
  PlanPipeline,
} from '../gen/workspacePipelines';

export interface CreateGenJobsOptions {
  readonly db: StorygramDatabase;
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly aiService: StoryboardAIService;
  readonly draftGenerator: DraftGenerator;
  readonly sender: ISendMessage;
  readonly jobsConfig: JobsConfig;
  readonly logger: Logger;
  readonly notifyInterrupted?: (jobs: readonly GenJob[]) => void;
}

export interface GenJobs {
  readonly manager: JobManager & IEnqueueJob;
  readonly start: () => void;
  readonly stop: () => Promise<void>;
}

// Assembles the generation stack: sqlite-backed queue, per-kind pipelines, Telegram progress, and
// boot recovery. Interrupted jobs are reported once, never silently retried — an AI call is a paid
// side effect, so re-running is always the user's decision.
export function createGenJobs(options: CreateGenJobsOptions): GenJobs {
  const jobStore = new SqliteJobStore(options.db);
  const queue = new JobQueue(jobStore);
  const stateMachine = new JobStateMachine();
  const runControl = new JobRunControl();

  const manager = new JobManager({
    store: jobStore,
    queue,
    stateMachine,
    onCancelRunning: (jobId) => runControl.cancel(jobId),
  });

  const pipeline = new KindDispatchPipeline({
    draft: new DraftPipeline({
      store: options.store,
      content: options.content,
      generator: options.draftGenerator,
    }),
    outline: new OutlinePipeline({
      store: options.store,
      content: options.content,
      aiService: options.aiService,
    }),
    plan: new PlanPipeline({
      store: options.store,
      content: options.content,
      aiService: options.aiService,
    }),
    manuscript: new ManuscriptPipeline({
      store: options.store,
      content: options.content,
      aiService: options.aiService,
    }),
  });

  const pipelineRunner = new PipelineRunner({
    store: jobStore,
    pipeline,
    createListeners: (job) => [
      new TelegramProgressReporter({
        sender: options.sender,
        logger: options.logger,
        onProgressMessageCreated: (ref) => {
          jobStore.updateState(job.id, { state: 'running', progressMessageId: ref.messageId });
        },
      }),
    ],
  });

  const executor = new JobExecutor({
    store: jobStore,
    stateMachine,
    manager,
    pipelineRunner,
    jobRunControl: runControl,
    logger: options.logger,
  });

  const worker = new JobWorker({ queue, executor, jobsConfig: options.jobsConfig });

  const recovery = new JobRecoveryService({
    store: jobStore,
    stateMachine,
    logger: options.logger,
    notify: options.notifyInterrupted,
  });

  return {
    manager,
    start: () => {
      recovery.recoverOnBoot();
      worker.start();
    },
    stop: () => worker.stop(),
  };
}
