import type { Logger } from "../util/logger"
import type { IAccessJobStore } from "./jobStorePort"
import type { JobManager } from "./jobManager"
import type { JobRunControl } from "./jobRunControl"
import type { JobStateMachine } from "./jobStateMachine"
import type { PipelineRunner } from "./pipelineRunner"
import type { GenJob, PipelineResult } from "./types"

export interface JobExecutorOptions {
  readonly store: IAccessJobStore
  readonly stateMachine: JobStateMachine
  readonly manager: JobManager
  readonly pipelineRunner: PipelineRunner
  readonly jobRunControl?: JobRunControl
  readonly logger: Logger
  readonly now?: () => number
}

// Runs a single job through queued → running → terminal, applying cancellation and error handling.
// Concurrency and polling live in JobWorker; this class owns one job's state transitions so each
// step stays small and testable.
export class JobExecutor {
  private readonly now: () => number

  public constructor(private readonly options: JobExecutorOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  public async execute(job: GenJob): Promise<void> {
    try {
      const running = this.startRunning(job)
      if (!running) {
        return
      }

      const result = await this.options.pipelineRunner.run(running, () =>
        this.options.manager.isCancelled(job.id)
      )
      this.finalize(job, result)
    } catch (error) {
      this.failAfterError(job, error)
    } finally {
      this.options.jobRunControl?.finish(job.id)
    }
  }

  // Claims a still-queued job and moves it to running. Returns undefined if it is no longer queued
  // (already picked up or terminal), so the caller stops.
  private startRunning(job: GenJob): GenJob | undefined {
    const current = this.options.store.load(job.id)
    if (!current || current.state !== "queued") {
      return undefined
    }

    const startedAt = this.now()
    this.options.jobRunControl?.start(job.id)
    this.options.stateMachine.assertAllowed(current.state, "running")
    return this.options.store.updateState(job.id, { state: "running", startedAt })
  }

  private finalize(job: GenJob, result: PipelineResult): void {
    if (this.options.manager.isCancelled(job.id)) {
      this.options.manager.markRunningCancelled(job.id)
      return
    }

    if (result.success) {
      this.options.stateMachine.assertAllowed("running", "succeeded")
      const latest = this.options.store.load(job.id)
      const usage =
        latest && (latest.usage.inputTokens > 0 || latest.usage.outputTokens > 0)
          ? latest.usage
          : (result.usage ?? latest?.usage)
      this.options.store.updateState(job.id, {
        state: "succeeded",
        finishedAt: this.now(),
        resultRef: result.resultRef ?? null,
        usage
      })
      return
    }

    this.options.stateMachine.assertAllowed("running", "failed")
    this.options.store.updateState(job.id, {
      state: "failed",
      failureReason: result.failureReason ?? "provider_error",
      finishedAt: this.now()
    })
  }

  private failAfterError(job: GenJob, error: unknown): void {
    this.options.logger.error(`잡 실행 실패: job=${job.id}`, error)
    try {
      this.options.stateMachine.assertAllowed("running", "failed")
      this.options.store.updateState(job.id, {
        state: "failed",
        failureReason: "provider_error",
        finishedAt: this.now()
      })
    } catch {
      // Job may have been moved to another terminal state.
    }
  }
}
