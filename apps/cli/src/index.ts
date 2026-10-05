import { ConsoleLogger } from './adapters/consoleLogger';
import { LiveArea } from './adapters/liveArea';
import { PauseRequests } from './adapters/pauseRequests';
import { TerminalPrompter } from './adapters/prompter';
import { dispatch } from './commands/dispatch';
import {
  bellSignal,
  createWindowTitle,
  longRunMilliseconds,
  popWindowTitle,
  pushWindowTitle,
} from './terminal/signals';
import { runTui } from './tui/index';

const version = '0.11.6';

// Shell completion runs inside the shell's own prompt and `completion` is `eval`ed; neither may
// touch the window. `help` and `tui` are not runs.
const verbsWithoutSignals = new Set(['__complete', 'completion', 'help', 'tui']);

// The words before the first flag name the run: `draft generate`.
function describeRun(argv: readonly string[]): string | undefined {
  const firstFlag = argv.findIndex((token) => token.startsWith('-'));
  const words = (firstFlag === -1 ? argv : argv.slice(0, firstFlag)).slice(0, 2);
  const isSignalled =
    words.length > 0 &&
    !verbsWithoutSignals.has(words[0] ?? '') &&
    process.stderr.isTTY === true &&
    process.env.TERM !== 'dumb' &&
    !argv.includes('--json');

  return isSignalled ? words.join(' ') : undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const runName = describeRun(argv);
  const startedAt = Date.now();

  if (runName !== undefined) {
    process.stderr.write(`${pushWindowTitle}${createWindowTitle(`Storyboard · ${runName}`)}`);
  }

  // NOTE: Ctrl+C 는 파이프의 받는 쪽(`| head`, `| cat`)도 끝낸다. 읽는 쪽이 없는 결과는 버릴 뿐
  // 실패가 아니므로, 종료 코드는 실행 결과대로 둔다.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      throw error;
    }
  });

  const liveArea = new LiveArea(process.stderr, () => process.stderr.columns || 80);
  const pauseRequests = new PauseRequests();

  // NOTE: 첫 Ctrl+C 는 씬 경계 정지를 예약하고(이미 쓴 토큰을 버리지 않게), 두 번째는 바로
  // 끝낸다. 멈출 수 있는 실행이 없으면 첫 번째부터 바로 끝낸다.
  process.on('SIGINT', () => {
    if (!pauseRequests.request()) {
      process.exit(130);
    }
    liveArea.writeAbove('지금 씬을 마치고 멈춥니다. 바로 끝내려면 Ctrl+C 를 한 번 더 누르세요.\n');
  });

  const isInteractive = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const result = await dispatch(argv, {
    version,
    cwd: process.cwd(),
    isInteractive,
    ...(isInteractive
      ? { createPrompter: (stderr) => new TerminalPrompter(process.stdin, liveArea, stderr) }
      : {}),
    createLogger: (showProgress, stderrTheme) =>
      new ConsoleLogger(showProgress, stderrTheme, (text) => liveArea.writeAbove(text)),
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
    const hasRunLong = Date.now() - startedAt >= longRunMilliseconds;
    process.stderr.write(`${popWindowTitle}${hasRunLong ? bellSignal : ''}`);
  }

  return result.exitCode;
}

void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ ok: false, message, data: null })}\n`);
    } else {
      process.stderr.write(`[error] ${message}\n`);
    }

    process.exitCode = 1;
  });
