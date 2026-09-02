import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { aiProviderIds, storyboardModelCatalog, type AiProviderId } from '@storyboard/story-ai';

import {
  flagBoolean,
  flagString,
  isParseFailure,
  parseArguments,
  resolveVerb,
} from './cliArguments';
import { findCommandSpec } from './commands/catalog';
import { commands, type CommandOutcome } from './commands/index';
import { createCliContainer } from './container';
import { renderCommandHelp, renderUnknownCommand, renderUsage } from './help';

const version = '0.8.1';

interface OutputMode {
  readonly json: boolean;
}

// stdout carries the result and nothing else, so an agent can pipe `--json` straight into a
// parser while progress and warnings go to stderr. A failure is a result too: with `--json` it is
// the same `{ok:false, message}` object on stdout, never loose text.
function report(outcome: CommandOutcome, mode: OutputMode): void {
  if (mode.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: outcome.ok, message: outcome.message, data: outcome.data ?? null })}\n`,
    );
    return;
  }

  process.stdout.write(`${outcome.message}\n`);
}

function fail(message: string, mode: OutputMode): number {
  if (mode.json) {
    report({ ok: false, message }, mode);
  } else {
    process.stderr.write(`${message}\n`);
  }

  return 1;
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv);
  const mode: OutputMode = { json: argv.includes('--json') };

  if (isParseFailure(parsed)) {
    return fail(`${parsed.message}\n전체 옵션: storyboard --help`, mode);
  }

  // `help <verb>` is not a handler, but it must resolve as a verb so the topic lands in positionals.
  const args = resolveVerb(parsed, [...Object.keys(commands), 'help']);

  if (flagBoolean(args.flags, 'version')) {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const verb = args.path.join(' ');

  // Bare `storyboard` and `--help` are entry points, not mistakes: usage goes to stdout, exit 0.
  if (args.path.length === 0 || verb === 'help') {
    const topic = verb === 'help' ? args.positionals.join(' ') : '';
    const commandHelp = topic.length > 0 ? renderCommandHelp(topic) : undefined;

    if (topic.length > 0 && commandHelp === undefined) {
      return fail(renderUnknownCommand(topic), mode);
    }

    process.stdout.write(commandHelp ?? renderUsage(version));
    return 0;
  }

  const handler = commands[verb];

  if (!handler) {
    return fail(renderUnknownCommand(verb), mode);
  }

  if (flagBoolean(args.flags, 'help')) {
    process.stdout.write(renderCommandHelp(verb) ?? renderUsage(version));
    return 0;
  }

  const providerFailure =
    validateProvider(flagString(args.flags, 'provider'), flagString(args.flags, 'model')) ??
    validateFallback(flagString(args.flags, 'fallback'));

  if (providerFailure !== undefined) {
    return fail(providerFailure, mode);
  }

  const workspacePath = resolve(flagString(args.flags, 'workspace') ?? process.cwd());
  const spec = findCommandSpec(verb);
  const needsWorkspace = spec?.needsWorkspace !== false;

  if (needsWorkspace && !existsSync(join(workspacePath, '.storyboard', 'project.json'))) {
    return fail(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        '  새로 만들려면   storyboard init --title "작품 이름"\n' +
        '  다른 곳이라면   storyboard <명령> --workspace <경로>',
      mode,
    );
  }

  const reviseIterations = flagString(args.flags, 'revise-iterations');
  const showProgress =
    flagBoolean(args.flags, 'verbose') ||
    (process.stderr.isTTY === true && !mode.json && !flagBoolean(args.flags, 'quiet'));
  const container = createCliContainer({
    workspacePath,
    showProgress,
    version,
    ...(flagString(args.flags, 'provider') === undefined
      ? {}
      : { provider: flagString(args.flags, 'provider') }),
    ...(flagString(args.flags, 'model') === undefined
      ? {}
      : { model: flagString(args.flags, 'model') }),
    ...(reviseIterations === undefined ? {} : { reviseMaxIterations: Number(reviseIterations) }),
    ...(flagString(args.flags, 'fallback') === undefined
      ? {}
      : { fallbackProvider: flagString(args.flags, 'fallback') }),
  });

  const outcome = await handler({ container, args });
  report(outcome, mode);
  return outcome.ok ? 0 : 1;
}

// SECURITY-adjacent: an unknown provider used to fall back to `mock`, which always succeeds — a
// typo would overwrite a real draft with synthetic text and still exit 0. Refuse instead: an
// unattended run has nobody to notice.
function validateProvider(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  if (provider === undefined) {
    return model === undefined
      ? undefined
      : '--model 은 --provider 와 함께 써야 합니다. 어느 프로바이더의 모델인지 알 수 없습니다.';
  }

  if (!aiProviderIds.includes(provider as AiProviderId)) {
    return `알 수 없는 프로바이더: ${provider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
  }

  const catalog = storyboardModelCatalog[provider as AiProviderId];

  if (model !== undefined && !catalog.some((entry) => entry.id === model)) {
    return (
      `${provider} 에 없는 모델: ${model}\n` +
      `쓸 수 있는 값: ${catalog.map((entry) => entry.id).join(', ')}`
    );
  }

  return undefined;
}

function validateFallback(provider: string | undefined): string | undefined {
  if (provider === undefined) {
    return undefined;
  }

  return aiProviderIds.includes(provider as AiProviderId)
    ? undefined
    : `알 수 없는 폴백 프로바이더: ${provider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
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
