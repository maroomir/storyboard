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

class CliChildRun {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stopTimers: NodeJS.Timeout[] = [];
  private timeoutTimer: NodeJS.Timeout | undefined;
  private failure: CliRunFailure | undefined;
  private stderr: string = '';
  private pendingLine: string = '';
  private isSettled: boolean = false;

  public constructor(
    private readonly request: CliRunRequest,
    private readonly resolve: (runResult: CliRunResult) => void,
  ) {
    this.child = spawn(request.command, [...request.args], {
      env: childEnvironment(request.withoutEnvironment),
      cwd: getEmptyWorkingDirectory(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: usesProcessGroup,
    });

    trackUntilClosed(this.child);
  }

  public start(): void {
    this.timeoutTimer = setTimeout(() => this.stop('timeout'), this.request.timeoutMs);
    this.watchAbortSignal();
    this.readChildOutput();

    this.child.on('error', this.onChildError);
    this.child.on('close', this.onChildClose);

    this.child.stdin.on('error', () => undefined);
    this.child.stdin.end(this.request.stdin);
  }

  private watchAbortSignal(): void {
    if (this.request.signal?.aborted) {
      this.onAbort();
    } else {
      this.request.signal?.addEventListener('abort', this.onAbort);
    }
  }

  private readChildOutput(): void {
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', this.onStdoutChunk);

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', this.onStderrChunk);
  }

  private readonly onAbort = (): void => this.stop('aborted');

  private readonly onStdoutChunk = (chunk: string): void => {
    const lines: string[] = (this.pendingLine + chunk).split('\n');
    this.pendingLine = lines.pop() ?? '';

    for (const line of lines) {
      this.request.onStdoutLine?.(line);
    }
  };

  private readonly onStderrChunk = (chunk: string): void => {
    this.stderr = (this.stderr + chunk).slice(-stderrTailLimit);
  };

  private readonly onChildError = (error: NodeJS.ErrnoException): void => {
    this.settle({
      exitCode: null,
      stderr: error.message,
      failure: error.code === 'ENOENT' ? 'not-found' : this.failure,
    });
  };

  private readonly onChildClose = (exitCode: number | null): void => {
    if (this.pendingLine.length > 0) {
      this.request.onStdoutLine?.(this.pendingLine);
    }

    this.settle({
      exitCode,
      stderr: this.stderr,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    });
  };

  private stop(reason: CliRunFailure): void {
    if (this.failure !== undefined) {
      return;
    }

    this.failure = reason;
    signalChildUnlessAlreadyExited(this.child, 'SIGTERM');
    this.stopTimers.push(
      setTimeout(
        () => signalChildUnlessAlreadyExited(this.child, 'SIGKILL'),
        stopGraceMilliseconds,
      ),
      setTimeout(
        () => this.settle({ exitCode: this.child.exitCode, stderr: this.stderr, failure: reason }),
        stopGraceMilliseconds + killGraceMilliseconds,
      ),
    );
  }

  private settle(runResult: CliRunResult): void {
    if (this.isSettled) {
      return;
    }

    this.isSettled = true;
    clearTimeout(this.timeoutTimer);
    this.stopTimers.forEach(clearTimeout);
    this.request.signal?.removeEventListener('abort', this.onAbort);
    this.resolve(runResult);
  }
}

export class NodeCliRunner implements ICliRunner {
  public run(request: CliRunRequest): Promise<CliRunResult> {
    return new Promise((resolve: (runResult: CliRunResult) => void): void => {
      new CliChildRun(request, resolve).start();
    });
  }
}
