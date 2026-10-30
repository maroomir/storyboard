import { assumedColumnsWithoutTerminal } from '@/terminal/profile';
import { ConsoleLogger } from '@/adapters/consoleLogger';
import { LiveArea } from '@/adapters/liveArea';
import { PauseRequests } from '@/adapters/pauseRequests';
import { TerminalPrompter } from '@/adapters/prompter';
import { CommandDispatcher, type DispatchResult } from '@/commands/commandDispatcher';
import {
  bellSignal,
  createWindowTitle,
  bellAfterRunLongerThanMs,
  popWindowTitle,
  pushWindowTitle,
} from '@/terminal/signals';
import { runTui } from '@/tui/index';
import { extractErrorMessage } from '@storyboard/story-model';

const version: string = '0.13.4';

const exitCodeOnInterrupt: number = 130;
const exitCodeOnTermination: number = 143;
const exitCodeOnHangup: number = 129;
const runNameWordCount: number = 2;

const verbsThatMustNotTouchWindowTitle: ReadonlySet<string> = new Set([
  '__complete',
  'completion',
  'help',
  'tui',
]);

function extractRunWords(argv: readonly string[]): readonly string[] {
  const firstFlagIndex: number = argv.findIndex((token: string) => token.startsWith('-'));
  const hasNoFlag: boolean = firstFlagIndex === -1;
  const wordsBeforeFlags: readonly string[] = hasNoFlag ? argv : argv.slice(0, firstFlagIndex);

  return wordsBeforeFlags.slice(0, runNameWordCount);
}

function shouldSignalRun(argv: readonly string[], runWords: readonly string[]): boolean {
  const hasRunWords: boolean = runWords.length > 0;
  const isVerbWithoutSignals: boolean = verbsThatMustNotTouchWindowTitle.has(runWords[0] ?? '');
  const isDrawingTerminal: boolean = process.stderr.isTTY === true && process.env.TERM !== 'dumb';
  const isJsonOutput: boolean = argv.includes('--json');

  return hasRunWords && !isVerbWithoutSignals && isDrawingTerminal && !isJsonOutput;
}

function ignoreClosedPipeOnStdout(): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    const isReaderGone: boolean = error.code === 'EPIPE';
    if (!isReaderGone) {
      throw error;
    }
  });
}

function stopAtSceneBoundaryOnFirstInterrupt(
  pauseRequests: PauseRequests,
  liveArea: LiveArea,
): void {
  process.on('SIGINT', () => {
    const hasPausableRun: boolean = pauseRequests.request();
    if (!hasPausableRun) {
      process.exit(exitCodeOnInterrupt);
    }
    liveArea.writeAbove('지금 씬을 마치고 멈춥니다. 바로 끝내려면 Ctrl+C 를 한 번 더 누르세요.\n');
  });
}

function exitNormallyOnTerminationSoChildProcessesStop(): void {
  process.on('SIGTERM', () => process.exit(exitCodeOnTermination));
  process.on('SIGHUP', () => process.exit(exitCodeOnHangup));
}

async function main(argv: readonly string[]): Promise<number> {
  const runWords: readonly string[] = extractRunWords(argv);
  const isSignallingRun: boolean = shouldSignalRun(argv, runWords);
  const startedAt: number = Date.now();

  if (isSignallingRun) {
    const runName: string = runWords.join(' ');
    process.stderr.write(`${pushWindowTitle}${createWindowTitle(`Storyboard · ${runName}`)}`);
  }

  ignoreClosedPipeOnStdout();

  const liveArea: LiveArea = new LiveArea(
    process.stderr,
    () => process.stderr.columns || assumedColumnsWithoutTerminal,
  );
  const pauseRequests: PauseRequests = new PauseRequests();

  stopAtSceneBoundaryOnFirstInterrupt(pauseRequests, liveArea);
  exitNormallyOnTerminationSoChildProcessesStop();

  const isInteractive: boolean = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const dispatched: DispatchResult = await new CommandDispatcher({
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
  }).dispatch(argv);

  if (dispatched.launchTui) {
    return runTui({ version, cwd: process.cwd() });
  }

  process.stdout.write(dispatched.stdout);
  process.stderr.write(dispatched.stderr);

  if (isSignallingRun) {
    const hasRunLong: boolean = Date.now() - startedAt >= bellAfterRunLongerThanMs;
    process.stderr.write(`${popWindowTitle}${hasRunLong ? bellSignal : ''}`);
  }

  return dispatched.exitCode;
}

void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message: string = extractErrorMessage(error);

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ ok: false, message, data: null })}\n`);
    } else {
      process.stderr.write(`[error] ${message}\n`);
    }

    process.exitCode = 1;
  });
