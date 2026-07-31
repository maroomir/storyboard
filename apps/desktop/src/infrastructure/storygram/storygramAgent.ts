import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const STORYGRAM_LAUNCHD_LABEL = 'com.maroomir.storygram';

export type AgentRestartResult =
  | { readonly status: 'restarted' }
  | { readonly status: 'not-installed' }
  | { readonly status: 'unsupported-platform' }
  | { readonly status: 'failed'; readonly detail: string };

export interface RestartAgentDeps {
  readonly platform?: NodeJS.Platform;
  readonly userId?: number;
  readonly execFileFn?: (
    command: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

// `kickstart -k` stops the running service and starts it again under launchd, which is what makes a
// config edit take effect — the bot reads its config only at boot.
export async function restartStorygramAgent(
  deps: RestartAgentDeps = {},
): Promise<AgentRestartResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') {
    return { status: 'unsupported-platform' };
  }

  const run = deps.execFileFn ?? execFileAsync;
  const userId = deps.userId ?? process.getuid?.();
  const target = `gui/${userId}/${STORYGRAM_LAUNCHD_LABEL}`;

  try {
    await run('launchctl', ['kickstart', '-k', target]);
    return { status: 'restarted' };
  } catch (error) {
    const detail = describeError(error);
    // launchctl reports an unknown label as "No such process" / error 3; that means the autostart
    // agent was never installed, which is a different fix than a genuine failure.
    if (/No such process|not find service|error 3/i.test(detail)) {
      return { status: 'not-installed' };
    }
    return { status: 'failed', detail };
  }
}

function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }

  const { stderr, stdout, message } = error as {
    stderr?: unknown;
    stdout?: unknown;
    message?: unknown;
  };
  return [stderr, stdout, message]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
}
