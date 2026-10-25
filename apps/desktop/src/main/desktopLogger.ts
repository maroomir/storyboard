import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { IStoryboardLogger } from '@storyboard/story-engine';

export class DesktopLogger implements IStoryboardLogger {
  public constructor(private readonly logFile: string) {
    mkdirSync(dirname(logFile), { recursive: true });
  }

  public info(message: string): void {
    this.write('info', message);
  }

  public warn(message: string): void {
    this.write('warn', message);
  }

  public error(message: string, error?: unknown): void {
    const detail: string = error instanceof Error ? `\n${error.stack ?? error.message}` : error === undefined ? '' : `\n${String(error)}`;
    this.write('error', `${message}${detail}`);
  }

  public show(): void {}

  private write(level: string, message: string): void {
    const line: string = `${new Date().toISOString()} [${level}] ${message}\n`;

    try {
      appendFileSync(this.logFile, line);
    } catch {
      process.stderr.write(line);
    }
  }
}
