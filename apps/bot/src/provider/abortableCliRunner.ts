import { spawn } from 'node:child_process';

import {
  createDefaultCliRunner,
  type CliRunInput,
  type CliRunResult,
  type CliRunner,
} from '@storyboard/story-ai';

export class JobAbortedError extends Error {
  public constructor() {
    super('job cancelled');
    this.name = 'JobAbortedError';
  }
}

export function createAbortableCliRunner(signal?: AbortSignal): CliRunner {
  if (!signal) {
    return createDefaultCliRunner();
  }

  return (input: CliRunInput) =>
    new Promise<CliRunResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(new JobAbortedError());
        return;
      }

      const child = spawn(input.command, [...input.args], { shell: false, cwd: input.cwd });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        signal.removeEventListener('abort', onAbort);
        action();
      };

      const onAbort = (): void => {
        child.kill('SIGTERM');
        finish(() => reject(new JobAbortedError()));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      const timer =
        input.timeoutMs !== undefined
          ? setTimeout(() => {
              child.kill('SIGKILL');
              finish(() =>
                reject(new Error(`CLI 실행이 ${input.timeoutMs}ms 안에 완료되지 않았습니다.`)),
              );
            }, input.timeoutMs)
          : undefined;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        finish(() => reject(error));
      });
      child.on('close', (code) => {
        finish(() => resolve({ stdout, stderr, exitCode: code }));
      });

      child.stdin?.on('error', () => {});

      if (input.stdin !== undefined) {
        child.stdin?.write(input.stdin);
      }
      child.stdin?.end();
    });
}
