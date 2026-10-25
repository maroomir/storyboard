import type { IStoryboardLogger } from '@storyboard/story-engine';

import { plainTheme, type Theme } from '@/terminal/theme';

export class ConsoleLogger implements IStoryboardLogger {
  public constructor(
    private readonly showProgress: boolean,
    private readonly theme: Theme = plainTheme,
    private readonly write: (text: string) => void = (text) => process.stderr.write(text),
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

  public show(): void {}
}
