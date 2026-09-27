export type AutosaveState = 'saved' | 'dirty' | 'saving';

export type DiskChange = 'echo' | 'reload' | 'conflict';

const defaultDelayMs = 1200;

// Keeps the editor's text and the draft on disk in step. Typing marks the draft dirty and saves it
// after a pause; a change on disk is classified against what this editor last wrote.
export class DraftAutosave {
  private pending: ReturnType<typeof setTimeout> | undefined;
  private body: string;
  private lastSavedBody: string;
  private currentState: AutosaveState = 'saved';
  private inFlight: Promise<void> = Promise.resolve();

  public constructor(
    initialBody: string,
    private readonly save: (body: string) => Promise<void>,
    private readonly onStateChange: (state: AutosaveState) => void,
    private readonly delayMs: number = defaultDelayMs,
  ) {
    this.body = initialBody;
    this.lastSavedBody = initialBody;
  }

  public get state(): AutosaveState {
    return this.currentState;
  }

  public change(body: string): void {
    this.body = body;
    this.setState(body === this.lastSavedBody ? 'saved' : 'dirty');
    this.clearPending();

    if (this.currentState === 'dirty') {
      this.pending = setTimeout(() => void this.flush(), this.delayMs);
    }
  }

  public async flush(): Promise<void> {
    this.clearPending();
    await this.inFlight;

    if (this.body === this.lastSavedBody) {
      this.setState('saved');
      return;
    }

    const body = this.body;
    this.setState('saving');
    this.inFlight = this.save(body).then(
      () => {
        this.lastSavedBody = body;
        this.setState(this.body === body ? 'saved' : 'dirty');
      },
      (error: unknown) => {
        this.setState('dirty');
        throw error;
      },
    );
    await this.inFlight;
  }

  // What to do when the draft file changed: our own save coming back is ignored, a change while the
  // editor has nothing unsaved is loaded, and a change over unsaved edits needs the author to choose.
  public classifyDiskChange(diskBody: string): DiskChange {
    if (diskBody === this.lastSavedBody || diskBody === this.body) {
      return 'echo';
    }

    return this.currentState === 'saved' ? 'reload' : 'conflict';
  }

  public acceptDisk(diskBody: string): void {
    this.clearPending();
    this.body = diskBody;
    this.lastSavedBody = diskBody;
    this.setState('saved');
  }

  public dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending !== undefined) {
      clearTimeout(this.pending);
      this.pending = undefined;
    }
  }

  private setState(state: AutosaveState): void {
    if (state !== this.currentState) {
      this.currentState = state;
      this.onStateChange(state);
    }
  }
}
