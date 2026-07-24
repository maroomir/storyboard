import type { IAccessJobStore } from "./jobStorePort"
import type { GenJob, JobClass } from "./types"
import { buildTargetKey } from "./types"
import type { JobTarget } from "./types"

export class JobQueue {
  public constructor(private readonly store: IAccessJobStore) {}

  public findActiveByTarget(target: JobTarget): GenJob | undefined {
    return this.store.findActiveByTarget(buildTargetKey(target))
  }

  public takeNext(jobClass: JobClass): GenJob | undefined {
    const queued = this.store.loadByState("queued")
    return queued.find((job) => job.class === jobClass)
  }

  public listQueued(jobClass?: JobClass): GenJob[] {
    const queued = this.store.loadByState("queued")
    return jobClass ? queued.filter((job) => job.class === jobClass) : queued
  }
}
