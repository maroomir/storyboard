import { spawn } from 'node:child_process';

export interface ShellCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface ShellCommandRun {
  readonly result: Promise<ShellCommandResult>;
  // Ends the command and whatever it started; an editor waiting for keys never ends by itself.
  readonly stop: () => void;
}

// `!git status` at the interactive prompt: the author's own shell runs the line in the work's
// folder, and what it printed comes back to the screen once it ends. The screen keeps the keyboard,
// so a command that waits for input (`!vim`) waits until it is stopped.
export function runShellCommand(command: string, cwd: string): ShellCommandRun {
  // Its own process group, so stopping the shell also stops the program the shell started.
  const child = spawn(process.env.SHELL ?? '/bin/sh', ['-c', command], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];

  const result = new Promise<ShellCommandResult>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => resolve({ exitCode: 127, output: error.message }));
    child.on('close', (code, signal) =>
      resolve({
        exitCode: code ?? (signal === null ? 1 : 130),
        output: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });

  const stop = (): void => {
    if (child.pid === undefined || child.exitCode !== null) {
      return;
    }

    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // NOTE: 그룹이 이미 끝났으면 멈출 것이 없다.
    }
  };

  return { result, stop };
}
