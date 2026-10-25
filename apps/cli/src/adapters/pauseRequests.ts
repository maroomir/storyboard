export class PauseRequests {
  private isWatched: boolean = false;
  private isRequested: boolean = false;

  public constructor(private readonly onWatch?: () => void) {}

  public watch(): () => boolean {
    this.isWatched = true;
    this.onWatch?.();
    return () => this.isRequested;
  }

  public request(): boolean {
    if (!this.isWatched || this.isRequested) {
      return false;
    }

    this.isRequested = true;
    return true;
  }
}
