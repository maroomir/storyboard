import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import {
  createDefaultCliRunner,
  type CliRunInput,
  type CliRunResult,
  type CliRunner,
} from '@storyboard/story-ai';

import { getActiveJobSignal } from './jobSignalContext';

export class JobAbortedError extends Error {
  public constructor() {
    super('job cancelled');
    this.name = 'JobAbortedError';
  }
}

const SIGKILL_ESCALATION_MS = 5000;

function runCliWithSignal(input: CliRunInput, signal: AbortSignal): Promise<CliRunResult> {
  return new Promise<CliRunResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new JobAbortedError());
      return;
    }

    const child = spawn(input.command, [...input.args], { shell: false, cwd: input.cwd });

    // Decoders carry partial UTF-8 sequences across chunk boundaries; naive chunk.toString() would
    // corrupt multibyte output (Korean prose) split mid-character.
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

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
      // A CLI that ignores SIGTERM (or is mid-network-call) must not linger as an orphan.
      killTimer = setTimeout(() => child.kill('SIGKILL'), SIGKILL_ESCALATION_MS);
      killTimer.unref();
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
      stdout += stdoutDecoder.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += stderrDecoder.write(chunk);
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      finish(() => resolve({ stdout, stderr, exitCode: code }));
    });

    child.stdin?.on('error', () => {});

    if (input.stdin !== undefined) {
      child.stdin?.write(input.stdin);
    }
    child.stdin?.end();
  });
}

export function createAbortableCliRunner(signal?: AbortSignal): CliRunner {
  if (!signal) {
    return createDefaultCliRunner();
  }

  return (input: CliRunInput) => runCliWithSignal(input, signal);
}

// The one runner instance shared by every CLI provider: each call binds to whichever job's signal
// is active on the async chain, so /stop aborts the underlying CLI process, not just the loop.
export function createJobAwareCliRunner(): CliRunner {
  const fallback = createDefaultCliRunner();

  return (input: CliRunInput) => {
    const signal = getActiveJobSignal();
    return signal ? runCliWithSignal(input, signal) : fallback(input);
  };
}
