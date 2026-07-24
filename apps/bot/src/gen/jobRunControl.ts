export class JobRunControl {
  private readonly controllers = new Map<number, AbortController>()

  public start(jobId: number): AbortSignal {
    const existing = this.controllers.get(jobId)
    if (existing) {
      return existing.signal
    }

    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    return controller.signal
  }

  public cancel(jobId: number): void {
    this.controllers.get(jobId)?.abort()
  }

  public finish(jobId: number): void {
    this.controllers.delete(jobId)
  }

  public getSignal(jobId: number): AbortSignal | undefined {
    return this.controllers.get(jobId)?.signal
  }
}
