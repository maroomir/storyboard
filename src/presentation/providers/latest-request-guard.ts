export class LatestRequestGuard {
  private readonly generationByKey = new Map<string, number>();
  private readonly timerByKey = new Map<string, ReturnType<typeof setTimeout>>();
  private isDisposed = false;

  public schedule(key: string, delayMs: number, task: () => Promise<void>): void {
    if (this.isDisposed) {
      return;
    }

    const generation = (this.generationByKey.get(key) ?? 0) + 1;
    this.generationByKey.set(key, generation);
    const previousTimer = this.timerByKey.get(key);

    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    const timer = setTimeout((): void => {
      this.timerByKey.delete(key);

      if (this.isDisposed || this.generationByKey.get(key) !== generation) {
        return;
      }

      void task();
    }, delayMs);
    this.timerByKey.set(key, timer);
  }

  public cancel(key: string): void {
    const timer = this.timerByKey.get(key);
    if (timer) {
      clearTimeout(timer);
    }

    this.timerByKey.delete(key);
    this.generationByKey.delete(key);
  }

  public dispose(): void {
    this.isDisposed = true;

    for (const timer of this.timerByKey.values()) {
      clearTimeout(timer);
    }

    this.timerByKey.clear();
    this.generationByKey.clear();
  }
}
