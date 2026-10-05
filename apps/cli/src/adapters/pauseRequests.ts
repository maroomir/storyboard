// 사람이 «여기서 멈춰» 라고 한 것. 씬 경계에서 멈출 수 있는 실행만 이것을 지켜보고, 그런 실행이
// 없을 때의 Ctrl+C 는 늘 그랬듯 바로 끝낸다.
export class PauseRequests {
  private isWatched = false;
  private isRequested = false;

  // Tells a screen that Esc now means something, so it can say so.
  public constructor(private readonly onWatch?: () => void) {}

  // A run that can stop at a scene boundary calls this and polls the returned check.
  public watch(): () => boolean {
    this.isWatched = true;
    this.onWatch?.();
    return () => this.isRequested;
  }

  // True when a watching run took the request and will stop at its next boundary; false means
  // nothing can pause (no run is watching, or a pause is already on its way), so the caller should
  // stop the process instead.
  public request(): boolean {
    if (!this.isWatched || this.isRequested) {
      return false;
    }

    this.isRequested = true;
    return true;
  }
}
