import { ConsoleLogger } from './adapters/consoleLogger';
import { dispatch } from './commands/dispatch';
import { runTui } from './tui/index';

const version = '0.11.5';

async function main(argv: readonly string[]): Promise<number> {
  const result = await dispatch(argv, {
    version,
    cwd: process.cwd(),
    isInteractive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    createLogger: (showProgress) => new ConsoleLogger(showProgress),
  });

  if (result.launchTui) {
    return runTui({ version, cwd: process.cwd() });
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
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
