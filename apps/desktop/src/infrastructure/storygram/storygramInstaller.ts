import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface InstallStep {
  readonly title: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface InstallOptions {
  readonly repoRoot: string;
  readonly hasNodeModules: boolean;
}

// SECURITY: every step is an argv array run without a shell, so a path containing spaces or shell
// metacharacters cannot turn into extra commands.
export function buildInstallSteps(options: InstallOptions): InstallStep[] {
  const steps: InstallStep[] = [];

  if (!options.hasNodeModules) {
    steps.push({ title: '의존성 설치', command: 'npm', args: ['install'] });
  }
  steps.push({ title: '봇 빌드', command: 'npm', args: ['run', 'bot:build'] });
  steps.push({
    title: '자동 시작 등록',
    command: join(options.repoRoot, 'apps', 'bot', 'scripts', 'install-launchd.sh'),
    args: [],
  });

  return steps;
}

export type InstallResult =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly failedStep: string; readonly output: string };

export interface RunInstallDeps {
  readonly execFileFn?: (
    command: string,
    args: readonly string[],
    options: { cwd: string },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly onStepStart?: (step: InstallStep, index: number, total: number) => void;
}

export async function runInstallSteps(
  repoRoot: string,
  steps: readonly InstallStep[],
  deps: RunInstallDeps = {},
): Promise<InstallResult> {
  const run = deps.execFileFn ?? execFileAsync;
  const transcript: string[] = [];

  for (const [index, step] of steps.entries()) {
    deps.onStepStart?.(step, index, steps.length);
    transcript.push(`$ ${step.command} ${step.args.join(' ')}`);

    try {
      const { stdout, stderr } = await run(step.command, step.args, { cwd: repoRoot });
      transcript.push(stdout, stderr);
    } catch (error) {
      transcript.push(describeExecError(error));
      return { ok: false, failedStep: step.title, output: transcript.join('\n') };
    }
  }

  return { ok: true, output: transcript.join('\n') };
}

function describeExecError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }

  const { stdout, stderr, message } = error as {
    stdout?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  return [stdout, stderr, message]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
}

export interface WaitForOnlineDeps<T> {
  readonly check: () => Promise<T>;
  readonly isOnline: (result: T) => boolean;
  readonly attempts: number;
  readonly delayMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

// launchd needs a moment to bootstrap the process and the dashboard needs a moment to bind, so the
// wizard polls instead of opening a browser at a port that is not listening yet.
export async function waitForStorygramOnline<T>(deps: WaitForOnlineDeps<T>): Promise<boolean> {
  const sleep =
    deps.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt < deps.attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(deps.delayMs);
    }
    if (deps.isOnline(await deps.check())) {
      return true;
    }
  }

  return false;
}
