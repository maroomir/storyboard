import { spawn } from 'node:child_process';

export interface ShellCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

// `!git status` at the interactive prompt: the author's own shell runs the line in the work's
// folder, and what it printed comes back to the screen once it ends.
export function runShellCommand(command: string, cwd: string): Promise<ShellCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL ?? '/bin/sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => resolve({ exitCode: 127, output: error.message }));
    child.on('close', (code) =>
      resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }),
    );
  });
}
