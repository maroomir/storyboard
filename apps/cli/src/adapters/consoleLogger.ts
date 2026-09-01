import type { IStoryboardLogger } from '@storyboard/story-engine';

// Everything goes to stderr so `--json` output on stdout stays machine-readable.
export class ConsoleLogger implements IStoryboardLogger {
  public constructor(private readonly verbose: boolean) {}

  public info(message: string): void {
    if (this.verbose) {
      process.stderr.write(`[info] ${message}\n`);
    }
  }

  public warn(message: string): void {
    process.stderr.write(`[warn] ${message}\n`);
  }

  public error(message: string, error?: unknown): void {
    process.stderr.write(`[error] ${message}\n`);

    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      return;
    }

    if (error !== undefined) {
      process.stderr.write(`${String(error)}\n`);
    }
  }

  // The log is already on screen; there is nothing to reveal.
  public show(): void {}
}
