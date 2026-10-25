import { ConsoleLogger } from './adapters/consoleLogger';
import { LiveArea } from './adapters/liveArea';
import { PauseRequests } from './adapters/pauseRequests';
import { TerminalPrompter } from './adapters/prompter';
import { dispatch, type DispatchResult } from './commands/dispatch';
import {
  bellSignal,
  createWindowTitle,
  longRunMilliseconds,
  popWindowTitle,
  pushWindowTitle,
} from './terminal/signals';
import { runTui } from './tui/index';

const version: string = '0.13.4';

const verbsWithoutSignals: Set<string> = new Set(['__complete', 'completion', 'help', 'tui']);

function extractRunName(argv: readonly string[]): string | undefined {
  const firstFlag: number = argv.findIndex((token) => token.startsWith('-'));
  const words: string[] = (firstFlag === -1 ? argv : argv.slice(0, firstFlag)).slice(0, 2);
  const isSignalled: boolean =
    words.length > 0 &&
    !verbsWithoutSignals.has(words[0] ?? '') &&
    process.stderr.isTTY === true &&
    process.env.TERM !== 'dumb' &&
    !argv.includes('--json');

  return isSignalled ? words.join(' ') : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const runName: string | undefined = extractRunName(argv);
  const startedAt: number = Date.now();

  if (runName !== undefined) {
    process.stderr.write(`${pushWindowTitle}${createWindowTitle(`Storyboard · ${runName}`)}`);
  }

  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      throw error;
    }
  });

  const liveArea: LiveArea = new LiveArea(process.stderr, () => process.stderr.columns || 80);
  const pauseRequests: PauseRequests = new PauseRequests();

  process.on('SIGINT', () => {
    if (!pauseRequests.request()) {
      process.exit(130);
    }
    liveArea.writeAbove('지금 씬을 마치고 멈춥니다. 바로 끝내려면 Ctrl+C 를 한 번 더 누르세요.\n');
  });

  process.on('SIGTERM', () => process.exit(143));
  process.on('SIGHUP', () => process.exit(129));

  const isInteractive: boolean = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const result: DispatchResult = await dispatch(argv, {
    version,
    cwd: process.cwd(),
    isInteractive,
    ...(isInteractive
      ? { createPrompter: (stderr) => new TerminalPrompter(process.stdin, liveArea, stderr) }
      : {}),
    createLogger: (showProgress, stderrTheme, showsErrorStack) =>
      new ConsoleLogger(
        showProgress,
        stderrTheme,
        (text) => liveArea.writeAbove(text),
        showsErrorStack,
      ),
    liveArea,
    pauseRequests,
    terminal: {
      stdout: { isTty: process.stdout.isTTY === true, columns: process.stdout.columns },
      stderr: { isTty: process.stderr.isTTY === true, columns: process.stderr.columns },
      env: process.env,
    },
  });

  if (result.launchTui) {
    return runTui({ version, cwd: process.cwd() });
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (runName !== undefined) {
    const hasRunLong: boolean = Date.now() - startedAt >= longRunMilliseconds;
    process.stderr.write(`${popWindowTitle}${hasRunLong ? bellSignal : ''}`);
  }

  return result.exitCode;
}

void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message: string = error instanceof Error ? error.message : String(error);

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ ok: false, message, data: null })}\n`);
    } else {
      process.stderr.write(`[error] ${message}\n`);
    }

    process.exitCode = 1;
  });
