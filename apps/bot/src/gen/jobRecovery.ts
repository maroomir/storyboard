import type { IAccessJobStore } from "./jobStorePort"
import type { Logger } from "../util/logger"
import { JobStateMachine } from "./jobStateMachine"
import type { GenJob } from "./types"

export interface JobRecoveryOptions {
  readonly store: IAccessJobStore
  readonly stateMachine: JobStateMachine
  readonly logger: Logger
  readonly notify?: (jobs: readonly GenJob[]) => void
  readonly now?: () => number
}

export class JobRecoveryService {
  private readonly now: () => number

  public constructor(private readonly options: JobRecoveryOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  public recoverOnBoot(): {
    readonly interrupted: readonly GenJob[]
    readonly queued: readonly GenJob[]
  } {
    const running = this.options.store.loadByState("running")
    const interrupted: GenJob[] = []

    for (const job of running) {
      this.options.stateMachine.assertAllowed(job.state, "interrupted")
      const updated = this.options.store.updateState(job.id, {
        state: "interrupted",
        finishedAt: this.now()
      })
      interrupted.push(updated)
      this.options.logger.warn(`기동 복구: running -> interrupted (job=${job.id})`)
    }

    const queued = this.options.store.loadByState("queued")
    if (interrupted.length > 0) {
      this.options.notify?.(interrupted)
    }

    if (queued.length > 0) {
      this.options.logger.info(`기동 복구: queued ${queued.length}건 재개 대기`)
    }

    return { interrupted, queued }
  }
}
