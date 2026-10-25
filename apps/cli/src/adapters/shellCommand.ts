import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type Stream from 'node:stream';

export interface ShellCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface ShellCommandRun {
  readonly result: Promise<ShellCommandResult>;
  readonly stop: () => void;
}

const exitCodeWhenShellCannotStart: number = 127;
const exitCodeWhenStoppedBySignal: number = 130;
const exitCodeWhenEndedWithoutCode: number = 1;

function stopProcessGroupUnlessAlreadyFinished(processGroupLeaderId: number): void {
  try {
    process.kill(-processGroupLeaderId, 'SIGTERM');
  } catch {
    return;
  }
}

export function runShellCommand(command: string, cwd: string): ShellCommandRun {
  const child: ChildProcessByStdio<null, Stream.Readable, Stream.Readable> = spawn(
    process.env.SHELL ?? '/bin/sh',
    ['-c', command],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const chunks: Buffer[] = [];

  const result: Promise<ShellCommandResult> = new Promise<ShellCommandResult>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) =>
      resolve({ exitCode: exitCodeWhenShellCannotStart, output: error.message }),
    );
    child.on('close', (code, signal) =>
      resolve({
        exitCode:
          code ?? (signal === null ? exitCodeWhenEndedWithoutCode : exitCodeWhenStoppedBySignal),
        output: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });

  const stop = (): void => {
    if (child.pid === undefined || child.exitCode !== null) {
      return;
    }

    stopProcessGroupUnlessAlreadyFinished(child.pid);
  };

  return { result, stop };
}
