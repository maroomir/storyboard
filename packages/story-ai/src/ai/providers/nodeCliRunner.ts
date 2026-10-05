import { spawn, type ChildProcess } from 'node:child_process';

import type { CliRunFailure, CliRunRequest, CliRunResult, ICliRunner } from '#ai/ports/cliRunner';

const stderrTailLimit = 4_000;

function childEnvironment(withheldPrefixes: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !withheldPrefixes.some((prefix) => name.startsWith(prefix)),
    ),
  );
}

// How long a child gets to end after SIGTERM before the whole group is killed, and how long after
// that the call returns regardless. A run must end in bounded time even when the executable ignores
// SIGTERM or a process under it keeps the output pipe open.
const stopGraceMilliseconds = 2_000;
const killGraceMilliseconds = 1_000;

// NOTE: 자식은 자기 프로세스 그룹의 리더로 띄운다. 그래야 실행 파일이 띄운 손자까지 한 번에 끝낼 수
// 있다. Windows 에는 그룹 신호가 없어 자식 하나만 끝낸다.
const usesProcessGroup = process.platform !== 'win32';

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
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
    // The group is already gone.
  }
}

const runningChildren = new Set<ChildProcess>();

// A host that exits mid-call must not leave the child running on: nobody would read what it writes,
// and it would go on spending the subscription. Its output is worthless by then, so it is killed
// outright. Hosts call this from their own shutdown paths (a signal, a closed window); a normal
// exit calls it through the process `exit` hook.
export function killRunningCliChildren(): void {
  for (const child of runningChildren) {
    signalChild(child, 'SIGKILL');
  }
}

let isExitHookInstalled = false;

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
      // SECURITY: no shell, so nothing in the arguments is ever interpreted as a command.
      const child = spawn(request.command, [...request.args], {
        env: childEnvironment(request.withoutEnvironment),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: usesProcessGroup,
      });

      trackUntilClosed(child);

      let failure: CliRunFailure | undefined;
      let stderr = '';
      let pendingLine = '';
      let isSettled = false;
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

      // SIGTERM, then SIGKILL to the whole group, then give up waiting for `close`: a grandchild
      // that escaped the group could otherwise hold the pipe open forever.
      const stop = (reason: CliRunFailure): void => {
        if (failure !== undefined) {
          return;
        }

        failure = reason;
        signalChild(child, 'SIGTERM');
        stopTimers.push(
          setTimeout(() => signalChild(child, 'SIGKILL'), stopGraceMilliseconds),
          setTimeout(
            () => settle({ exitCode: child.exitCode, stderr, failure: reason }),
            stopGraceMilliseconds + killGraceMilliseconds,
          ),
        );
      };
      const onAbort = (): void => stop('aborted');
      const timer = setTimeout(() => stop('timeout'), request.timeoutMs);

      if (request.signal?.aborted) {
        onAbort();
      } else {
        request.signal?.addEventListener('abort', onAbort);
      }

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const lines = (pendingLine + chunk).split('\n');
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

      // The child may exit before it reads everything; its exit code already says so.
      child.stdin.on('error', () => undefined);
      child.stdin.end(request.stdin);
    });
  }
}
