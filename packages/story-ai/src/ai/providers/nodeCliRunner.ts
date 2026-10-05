import { spawn } from 'node:child_process';

import type { CliRunFailure, CliRunRequest, CliRunResult, ICliRunner } from '#ai/ports/cliRunner';

const stderrTailLimit = 4_000;

function childEnvironment(withoutEnvironment: readonly string[]): NodeJS.ProcessEnv {
  const environment = { ...process.env };

  for (const name of withoutEnvironment) {
    delete environment[name];
  }

  return environment;
}

export class NodeCliRunner implements ICliRunner {
  public run(request: CliRunRequest): Promise<CliRunResult> {
    return new Promise((resolve) => {
      // SECURITY: no shell, so nothing in the arguments is ever interpreted as a command.
      const child = spawn(request.command, [...request.args], {
        env: childEnvironment(request.withoutEnvironment),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let failure: CliRunFailure | undefined;
      let stderr = '';
      let pendingLine = '';
      let isSettled = false;

      const stop = (reason: CliRunFailure): void => {
        failure ??= reason;
        child.kill('SIGTERM');
      };
      const onAbort = (): void => stop('aborted');
      const timer = setTimeout(() => stop('timeout'), request.timeoutMs);

      const settle = (result: CliRunResult): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

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
