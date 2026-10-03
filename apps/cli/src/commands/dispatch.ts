import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { aiProviderIds, storyboardModelCatalog, type AiProviderId } from '@storyboard/story-ai';
import { configurationTargets, type ConfigurationTarget } from '@storyboard/story-config';
import {
  getStoryboardProjectPaths,
  migrateLegacyMemory,
  type IStoryboardLogger,
} from '@storyboard/story-engine';

import {
  flagBoolean,
  flagString,
  isParseFailure,
  parseArguments,
  resolveVerb,
} from '@/cliArguments';
import { createCliContainer } from '@/container';
import { renderCommandHelp, renderUnknownCommand, renderUsage } from '@/help';
import { findCommandSpec } from './catalog';
import {
  completionShells,
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
} from './completion';
import { commands } from './index';
import type { CommandOutcome } from './outcome';
import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-model';

// 설정 파일을 쓰는 verb 는 이 둘뿐이다. API 키는 0600 홈 파일 하나로 고정이라 여기 없다.
const configWritingVerbs = new Set(['setup', 'config set']);

function resolveConfigWriteTarget(
  isGlobal: boolean,
  isWorkspace: boolean,
): ConfigurationTarget | undefined {
  if (isGlobal) {
    return configurationTargets.user;
  }

  return isWorkspace ? configurationTargets.workspace : undefined;
}

export interface DispatchDependencies {
  readonly version: string;
  readonly cwd: string;
  // Whether a person can answer questions (setup) and wants progress lines by default.
  readonly isInteractive: boolean;
  readonly createLogger: (showProgress: boolean) => IStoryboardLogger;
}

export interface DispatchResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outcome?: CommandOutcome;
  // Set when the argv asked for the interactive screen instead of a one-shot command.
  readonly launchTui?: boolean;
}

interface OutputMode {
  readonly json: boolean;
}

// stdout carries the result and nothing else, so an agent can pipe `--json` straight into a
// parser while progress and warnings go to stderr. A failure is a result too: with `--json` it is
// the same `{ok:false, message}` object on stdout, never loose text.
function reportText(outcome: CommandOutcome, mode: OutputMode): string {
  if (mode.json) {
    return `${JSON.stringify({ ok: outcome.ok, message: outcome.message, data: outcome.data ?? null })}\n`;
  }

  return `${outcome.message}\n`;
}

function failure(message: string, mode: OutputMode): DispatchResult {
  const outcome: CommandOutcome = { ok: false, message };

  return mode.json
    ? { exitCode: 1, stdout: reportText(outcome, mode), stderr: '', outcome }
    : { exitCode: 1, stdout: '', stderr: `${message}\n`, outcome };
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

  // 로컬 런타임의 모델 목록은 기계마다 다르다. 카탈로그는 제안이고 진짜 목록은 ollama 가 갖는다.
  if (
    provider !== 'ollama' &&
    model !== undefined &&
    !catalog.some((entry) => entry.id === model)
  ) {
    return (
      `${provider} 에 없는 모델: ${model}\n` +
      `쓸 수 있는 값: ${catalog.map((entry) => entry.id).join(', ')}`
    );
  }

  return undefined;
}

// One entry for both faces of the CLI: `index.ts` prints what comes back, the TUI renders it.
export async function dispatch(
  argv: readonly string[],
  deps: DispatchDependencies,
): Promise<DispatchResult> {
  // The shell hands over the half-typed line verbatim, so it must not go through the parser,
  // which would reject the partial flag the author is in the middle of typing.
  if (argv[0] === '__complete') {
    const completions = computeCompletions(argv.slice(1), { cwd: deps.cwd });
    const text = formatCompletions(completions);
    return { exitCode: 0, stdout: text.length > 0 ? `${text}\n` : '', stderr: '' };
  }

  const parsed = parseArguments(argv);
  const mode: OutputMode = { json: argv.includes('--json') };

  if (isParseFailure(parsed)) {
    return failure(`${parsed.message}\n전체 옵션: storyboard --help`, mode);
  }

  // `help <verb>` and `tui` are not handlers, but they must resolve as verbs.
  const args = resolveVerb(parsed, [...Object.keys(commands), 'help', 'tui', 'completion']);

  if (flagBoolean(args.flags, 'version')) {
    return { exitCode: 0, stdout: `${deps.version}\n`, stderr: '' };
  }

  const verb = args.path.join(' ');

  if (
    verb === 'tui' ||
    (args.path.length === 0 && deps.isInteractive && !flagBoolean(args.flags, 'help'))
  ) {
    return { exitCode: 0, stdout: '', stderr: '', launchTui: true };
  }

  // Bare `storyboard` and `--help` are entry points, not mistakes: usage goes to stdout, exit 0.
  if (args.path.length === 0 || verb === 'help') {
    const topic = verb === 'help' ? args.positionals.join(' ') : '';
    const commandHelp = topic.length > 0 ? renderCommandHelp(topic) : undefined;

    if (topic.length > 0 && commandHelp === undefined) {
      return failure(renderUnknownCommand(topic), mode);
    }

    return { exitCode: 0, stdout: commandHelp ?? renderUsage(deps.version), stderr: '' };
  }

  // `eval "$(storyboard completion zsh)"` runs on every shell start, so it must stay a pure
  // print: no container, no config read, nothing on stderr.
  if (verb === 'completion') {
    const script = renderCompletionScript(args.positionals[0] ?? '');
    return script === undefined
      ? failure(`셸을 지정해 주세요: storyboard completion <${completionShells.join('|')}>`, mode)
      : { exitCode: 0, stdout: script, stderr: '' };
  }

  const handler = commands[verb];

  if (!handler) {
    return failure(renderUnknownCommand(verb), mode);
  }

  if (flagBoolean(args.flags, 'help')) {
    return {
      exitCode: 0,
      stdout: renderCommandHelp(verb) ?? renderUsage(deps.version),
      stderr: '',
    };
  }

  const providerFailure = validateProvider(
    flagString(args.flags, 'provider'),
    flagString(args.flags, 'model'),
  );

  if (providerFailure !== undefined) {
    return failure(providerFailure, mode);
  }

  const workspacePath = resolve(deps.cwd, flagString(args.flags, 'workspace') ?? '.');
  const spec = findCommandSpec(verb);
  const needsWorkspace = spec?.needsWorkspace !== false;
  const isWorkspace = existsSync(join(workspacePath, STORYBOARD_RELATIVE_PATHS.projectJson));

  // NOTE: git 과 같은 규칙 — 설정은 지금 있는 작품에 저장하고, 모든 작품에 걸려면 --global 을
  // 명시한다. 작품 밖에서 플래그 없이 부르면 어디에 쓰는지 모호하므로 거부한다.
  const configWriteTarget = configWritingVerbs.has(verb)
    ? resolveConfigWriteTarget(flagBoolean(args.flags, 'global'), isWorkspace)
    : undefined;

  if (configWriteTarget === undefined && configWritingVerbs.has(verb)) {
    return failure(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        `  이 작품에 저장하려면   storyboard ${verb} --workspace <경로>\n` +
        `  모든 작품에 저장하려면 storyboard ${verb} --global`,
      mode,
    );
  }

  if (needsWorkspace && !isWorkspace) {
    return failure(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        '  새로 만들려면   storyboard init --title "작품 이름"\n' +
        '  다른 곳이라면   storyboard <명령> --workspace <경로>',
      mode,
    );
  }

  const reviseIterations = flagString(args.flags, 'revise-iterations');
  const showProgress =
    flagBoolean(args.flags, 'verbose') ||
    (deps.isInteractive && !mode.json && !flagBoolean(args.flags, 'quiet'));
  const container = createCliContainer({
    workspacePath,
    logger: deps.createLogger(showProgress),
    canPrompt: deps.isInteractive,
    version: deps.version,
    ...(flagString(args.flags, 'provider') === undefined
      ? {}
      : { provider: flagString(args.flags, 'provider') }),
    ...(flagString(args.flags, 'model') === undefined
      ? {}
      : { model: flagString(args.flags, 'model') }),
    ...(reviseIterations === undefined ? {} : { reviseMaxIterations: Number(reviseIterations) }),
    ...(configWriteTarget === undefined ? {} : { configWriteTarget }),
  });

  if (needsWorkspace) {
    await migrateLegacyMemory(
      container.fileSystem,
      getStoryboardProjectPaths(container.workspaceRoot),
    );

    const resources = await container.loadResourceOverrides();
    for (const problem of resources.problems) {
      container.logger.warn(problem.message);
    }
  }

  const outcome =
    spec?.writesWorkspace === true
      ? await runHoldingWorkspaceLock(container, verb, () => handler({ container, args }))
      : await handler({ container, args });

  return {
    exitCode: outcome.ok ? 0 : 1,
    stdout: reportText(outcome, mode),
    stderr: '',
    outcome,
  };
}

async function runHoldingWorkspaceLock(
  container: ReturnType<typeof createCliContainer>,
  verb: string,
  run: () => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  const held = await container.runGate.hold(container.workspaceRoot, `storyboard ${verb}`, run);

  if (!held.ok) {
    return {
      ok: false,
      message: `${held.message}. 끝난 뒤 다시 실행하세요.`,
      data: { heldBy: held.heldBy },
    };
  }

  return held.value;
}
