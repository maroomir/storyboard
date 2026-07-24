// Keeps network I/O off the response path: commits trigger a debounced push, and a periodic timer
// pulls remote changes. The actual work is delegated to the injected sync function.
export class PushScheduler {
  private debounceTimer: NodeJS.Timeout | undefined;
  private periodicTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly debounceMs: number,
    private readonly intervalMs: number,
    private readonly sync: () => void,
  ) {}

  public requestPush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.sync();
    }, this.debounceMs);
  }

  public startPeriodic(): void {
    if (this.periodicTimer) {
      return;
    }

    this.periodicTimer = setInterval(() => this.sync(), this.intervalMs);
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }
}
