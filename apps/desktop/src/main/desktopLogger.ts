import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { IStoryboardLogger } from '@storyboard/story-engine';

// The engine's log goes to a file the author can attach to a bug report; nothing is on screen to
// reveal it, so `show` is a no-op. SECURITY: callers never pass API keys, and none is logged here.
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
    const detail = error instanceof Error ? `\n${error.stack ?? error.message}` : error === undefined ? '' : `\n${String(error)}`;
    this.write('error', `${message}${detail}`);
  }

  public show(): void {}

  private write(level: string, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;

    // NOTE: 로그 파일을 못 써도 앱은 계속 돌아야 한다. 로그는 진단용이지 작업의 일부가 아니다.
    try {
      appendFileSync(this.logFile, line);
    } catch {
      process.stderr.write(line);
    }
  }
}
