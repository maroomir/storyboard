import type { IStoryboardLogger } from '@storyboard/story-engine';

import { plainTheme, type Theme } from '@/terminal/theme';

// Everything goes to stderr so `--json` output on stdout stays machine-readable.
export class ConsoleLogger implements IStoryboardLogger {
  public constructor(
    private readonly showProgress: boolean,
    private readonly theme: Theme = plainTheme,
  ) {}

  public info(message: string): void {
    if (this.showProgress) {
      process.stderr.write(`${this.theme.paint('muted', '·')} ${message}\n`);
    }
  }

  public warn(message: string): void {
    process.stderr.write(`${this.theme.paint('warning', '[warn]')} ${message}\n`);
  }

  public error(message: string, error?: unknown): void {
    process.stderr.write(`${this.theme.paint('danger', '[error]')} ${message}\n`);

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
