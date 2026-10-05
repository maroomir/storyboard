import type { IStoryboardLogger } from '@storyboard/story-engine';

import { plainTheme, type Theme } from '@/terminal/theme';

// Everything goes to stderr so `--json` output on stdout stays machine-readable.
export class ConsoleLogger implements IStoryboardLogger {
  public constructor(
    private readonly showProgress: boolean,
    private readonly theme: Theme = plainTheme,
    // Writes above a live progress rail when one is drawn, so a warning never tears it.
    private readonly write: (text: string) => void = (text) => process.stderr.write(text),
    // A stack trace is for whoever debugs the CLI (`--verbose`); an author gets the message.
    private readonly showsErrorStack = true,
  ) {}

  public info(message: string): void {
    if (this.showProgress) {
      this.write(`${this.theme.paint('muted', '·')} ${message}\n`);
    }
  }

  public warn(message: string): void {
    this.write(`${this.theme.paint('warning', '[warn]')} ${message}\n`);
  }

  public error(message: string, error?: unknown): void {
    this.write(`${this.theme.paint('danger', '[error]')} ${message}\n`);

    if (error instanceof Error) {
      this.write(`${(this.showsErrorStack ? error.stack : undefined) ?? error.message}\n`);
      return;
    }

    if (error !== undefined) {
      this.write(`${String(error)}\n`);
    }
  }

  // The log is already on screen; there is nothing to reveal.
  public show(): void {}
}
