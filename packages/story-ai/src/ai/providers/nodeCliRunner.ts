import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliRunFailure, CliRunRequest, CliRunResult, ICliRunner } from '#ai/ports/cliRunner';

const stderrTailLimit: number = 4_000;

function childEnvironment(withheldPrefixes: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !withheldPrefixes.some((prefix) => name.startsWith(prefix)),
    ),
  );
}

const stopGraceMilliseconds: number = 2_000;
const killGraceMilliseconds: number = 1_000;

const usesProcessGroup: boolean = process.platform !== 'win32';

function signalChildUnlessAlreadyExited(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    if (usesProcessGroup) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    return;
  }
}

let emptyWorkingDirectory: string | undefined;

function getEmptyWorkingDirectory(): string {
  emptyWorkingDirectory ??= mkdtempSync(join(tmpdir(), 'storyboard-cli-'));
  return emptyWorkingDirectory;
}

const runningChildren: Set<ChildProcess> = new Set<ChildProcess>();

export function killRunningCliChildren(): void {
  for (const child of runningChildren) {
    signalChildUnlessAlreadyExited(child, 'SIGKILL');
  }

  if (emptyWorkingDirectory !== undefined) {
    rmSync(emptyWorkingDirectory, { recursive: true, force: true });
    emptyWorkingDirectory = undefined;
  }
}

let isExitHookInstalled: boolean = false;

function trackUntilClosed(child: ChildProcess): void {
  if (!isExitHookInstalled) {
    isExitHookInstalled = true;
    process.once('exit', killRunningCliChildren);
  }

  runningChildren.add(child);
  child.once('exit', () => runningChildren.delete(child));
  child.once('error', () => runningChildren.delete(child));
}

export class NodeCliRunner implements ICliRunner {
  public run(request: CliRunRequest): Promise<CliRunResult> {
    return new Promise((resolve) => {
      const child: ChildProcessWithoutNullStreams = spawn(request.command, [...request.args], {
        env: childEnvironment(request.withoutEnvironment),
        cwd: getEmptyWorkingDirectory(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: usesProcessGroup,
      });

      trackUntilClosed(child);

      let failure: CliRunFailure | undefined;
      let stderr: string = '';
      let pendingLine: string = '';
      let isSettled: boolean = false;
      const stopTimers: NodeJS.Timeout[] = [];

      const settle = (result: CliRunResult): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(timer);
        stopTimers.forEach(clearTimeout);
        request.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const stop = (reason: CliRunFailure): void => {
        if (failure !== undefined) {
          return;
        }

        failure = reason;
        signalChildUnlessAlreadyExited(child, 'SIGTERM');
        stopTimers.push(
          setTimeout(() => signalChildUnlessAlreadyExited(child, 'SIGKILL'), stopGraceMilliseconds),
          setTimeout(
            () => settle({ exitCode: child.exitCode, stderr, failure: reason }),
            stopGraceMilliseconds + killGraceMilliseconds,
          ),
        );
      };
      const onAbort = (): void => stop('aborted');
      const timer: NodeJS.Timeout = setTimeout(() => stop('timeout'), request.timeoutMs);

      if (request.signal?.aborted) {
        onAbort();
      } else {
        request.signal?.addEventListener('abort', onAbort);
      }

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const lines: string[] = (pendingLine + chunk).split('\n');
        pendingLine = lines.pop() ?? '';

        for (const line of lines) {
          request.onStdoutLine?.(line);
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-stderrTailLimit);
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        settle({
          exitCode: null,
          stderr: error.message,
          failure: error.code === 'ENOENT' ? 'not-found' : failure,
        });
      });

      child.on('close', (exitCode) => {
        if (pendingLine.length > 0) {
          request.onStdoutLine?.(pendingLine);
        }

        settle({ exitCode, stderr, ...(failure === undefined ? {} : { failure }) });
      });

      child.stdin.on('error', () => undefined);
      child.stdin.end(request.stdin);
    });
  }
}
