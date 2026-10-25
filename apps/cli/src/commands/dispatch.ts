import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  storyboardModelCatalog,
  type AiProviderId,
  STORYBOARD_RELATIVE_PATHS,
  getStoryboardProjectPaths,
  usageCacheHitRate,
  type ProviderModelOptions,
} from '@storyboard/story-model';
import { configurationTargets, type ConfigurationTarget } from '@storyboard/story-config';
import {
  migrateLegacyMemory,
  type IStoryboardLogger,
  type UsageMeterSession,
} from '@storyboard/story-engine';

import {
  flagBoolean,
  flagString,
  isParseFailure,
  parseArguments,
  resolveVerb,
  type ParsedArguments,
  type ParseFailure,
  type RawArguments,
} from '@/cliArguments';
import type { LiveArea } from '@/adapters/liveArea';
import type { PauseRequests } from '@/adapters/pauseRequests';
import type { IPrompter } from '@/adapters/prompter';
import { LineRunProgress, RailRunProgress, type IRunProgress } from '@/adapters/runProgress';
import { createCliContainer, type CliContainer } from '@/container';
import {
  createTerminalProfile,
  plainTerminalFacts,
  type TerminalFacts,
  type TerminalProfile,
  type TerminalStream,
} from '@/terminal/profile';
import { diffSentences, renderSentenceDiff } from '@/terminal/diff';
import { linkFilePaths } from '@/terminal/signals';
import type { Theme } from '@/terminal/theme';
import {
  renderCommandHelp,
  renderFullUsage,
  renderHelpTopic,
  renderUnknownCommand,
  renderUnknownFlag,
  renderUsage,
} from '@/help';
import { findCommandSpec, type CommandSpec } from './catalog';
import {
  completionShells,
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
  type Completion,
} from './completion';
import { commands } from './index';
import type { CommandHandler, CommandOutcome } from './outcome';
import { markOutcome, renderNextStep } from './outcomeView';
import { availableProviderIds } from '@/adapters/availableProviders';
import type { ResourceOverrideReport, WorkspaceHoldResult } from '@storyboard/story-app';

const configWritingVerbs: Set<string> = new Set(['setup', 'config set', 'config unset']);

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
  readonly isInteractive: boolean;
  readonly createLogger: (
    showProgress: boolean,
    stderrTheme: Theme,
    showsErrorStack: boolean,
  ) => IStoryboardLogger;
  readonly terminal?: TerminalFacts;
  readonly liveArea?: LiveArea;
  readonly pauseRequests?: PauseRequests;
  readonly createPrompter?: (stderr: TerminalStream) => IPrompter;
}

export interface DispatchResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly outcome?: CommandOutcome;
  readonly launchTui?: boolean;
  readonly costUsd?: number;
}

interface RunUsageReaders {
  readCostUsd: () => number;
  readUnpricedTokens: () => number;
  readCacheHitRate: () => number | undefined;
}

interface OutputMode {
  readonly json: boolean;
}

function reportText(outcome: CommandOutcome, mode: OutputMode): string {
  if (mode.json) {
    return `${JSON.stringify({ ok: outcome.ok, message: outcome.message, data: outcome.data ?? null })}\n`;
  }

  return `${outcome.message}\n`;
}

function failure(message: string, mode: OutputMode, stream: TerminalStream): DispatchResult {
  const outcome: CommandOutcome = { ok: false, message };

  return mode.json
    ? { exitCode: 1, stdout: reportText(outcome, mode), stderr: '', outcome }
    : {
        exitCode: 1,
        stdout: '',
        stderr: `${markOutcome(message, { ok: false, isAction: false }, stream)}\n`,
        outcome,
      };
}

function validateProvider(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  if (provider === undefined) {
    return model === undefined
      ? undefined
      : '--model 은 --provider 와 함께 써야 합니다. 어느 프로바이더의 모델인지 알 수 없습니다.';
  }

  if (!availableProviderIds().includes(provider as AiProviderId)) {
    return `알 수 없는 프로바이더: ${provider}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
  }

  const catalog: ProviderModelOptions = storyboardModelCatalog[provider as AiProviderId];

  const hasMachineSpecificModelList: boolean = provider === 'ollama';

  if (
    !hasMachineSpecificModelList &&
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

function removeVerbWords(argv: readonly string[], verbWords: readonly string[]): string[] {
  const rest: string[] = [...argv];

  for (const word of verbWords) {
    const index: number = rest.indexOf(word);
    if (index !== -1) {
      rest.splice(index, 1);
    }
  }

  return rest;
}

export async function dispatch(
  argv: readonly string[],
  deps: DispatchDependencies,
): Promise<DispatchResult> {
  if (argv[0] === '__complete') {
    const completions: Completion[] = computeCompletions(argv.slice(1), { cwd: deps.cwd });
    const text: string = formatCompletions(completions);
    return { exitCode: 0, stdout: text.length > 0 ? `${text}\n` : '', stderr: '' };
  }

  const parsed: RawArguments | ParseFailure = parseArguments(argv);
  const mode: OutputMode = { json: argv.includes('--json') };
  const terminal: TerminalProfile = createTerminalProfile(deps.terminal ?? plainTerminalFacts, {
    hasNoColorFlag: argv.includes('--no-color'),
    isJsonOutput: mode.json,
  });

  if (isParseFailure(parsed)) {
    return failure(
      parsed.unknownFlag === undefined
        ? `${parsed.message}\n전체 옵션: storyboard --help`
        : renderUnknownFlag(parsed.unknownFlag),
      mode,
      terminal.stderr,
    );
  }

  const args: ParsedArguments = resolveVerb(parsed, [
    ...Object.keys(commands),
    'help',
    'tui',
    'completion',
  ]);

  if (flagBoolean(args.flags, 'version')) {
    return { exitCode: 0, stdout: `${deps.version}\n`, stderr: '' };
  }

  const verb: string = args.path.join(' ');

  if (
    verb === 'tui' ||
    (args.path.length === 0 && deps.isInteractive && !flagBoolean(args.flags, 'help'))
  ) {
    return { exitCode: 0, stdout: '', stderr: '', launchTui: true };
  }

  if (args.path.length === 0 || verb === 'help') {
    const topic: string = verb === 'help' ? args.positionals.join(' ') : '';

    if (topic.length > 0) {
      const topicHelp: string | undefined = renderHelpTopic(topic, terminal.stdout);
      return topicHelp === undefined
        ? failure(renderUnknownCommand(topic), mode, terminal.stderr)
        : { exitCode: 0, stdout: topicHelp, stderr: '' };
    }

    const usage: string = flagBoolean(args.flags, 'all')
      ? renderFullUsage(deps.version, terminal.stdout)
      : renderUsage(deps.version, terminal.stdout);
    return { exitCode: 0, stdout: usage, stderr: '' };
  }

  if (verb === 'completion') {
    const script: string | undefined = renderCompletionScript(args.positionals[0] ?? '');
    return script === undefined
      ? failure(
          `셸을 지정해 주세요: storyboard completion <${completionShells.join('|')}>`,
          mode,
          terminal.stderr,
        )
      : { exitCode: 0, stdout: script, stderr: '' };
  }

  const handler: CommandHandler | undefined = commands[verb];

  if (!handler) {
    return failure(
      renderUnknownCommand(verb, removeVerbWords(argv, args.path)),
      mode,
      terminal.stderr,
    );
  }

  if (flagBoolean(args.flags, 'help')) {
    return {
      exitCode: 0,
      stdout:
        renderCommandHelp(verb, terminal.stdout) ?? renderUsage(deps.version, terminal.stdout),
      stderr: '',
    };
  }

  const providerFailure: string | undefined =
    verb === 'config set'
      ? undefined
      : validateProvider(flagString(args.flags, 'provider'), flagString(args.flags, 'model'));

  if (
    (verb === 'config set' || verb === 'config unset') &&
    flagString(args.flags, 'provider') !== undefined
  ) {
    return failure(
      `--provider 는 이번 실행에 쓸 프로바이더를 정하는 옵션이라 ${verb} 과 함께 쓸 수 없습니다.\n` +
        '  기본 프로바이더를 바꾸려면   storyboard config set ai.provider.default <프로바이더>',
      mode,
      terminal.stderr,
    );
  }

  if (providerFailure !== undefined) {
    return failure(providerFailure, mode, terminal.stderr);
  }

  const workspacePath: string = resolve(deps.cwd, flagString(args.flags, 'workspace') ?? '.');
  const spec: CommandSpec | undefined = findCommandSpec(verb);
  const needsWorkspace: boolean = spec?.needsWorkspace !== false;
  const isWorkspace: boolean = existsSync(
    join(workspacePath, STORYBOARD_RELATIVE_PATHS.projectJson),
  );

  const configWriteTarget: ConfigurationTarget | undefined = configWritingVerbs.has(verb)
    ? resolveConfigWriteTarget(flagBoolean(args.flags, 'global'), isWorkspace)
    : undefined;

  if (configWriteTarget === undefined && configWritingVerbs.has(verb)) {
    return failure(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        `  이 작품에 저장하려면   storyboard ${verb} --workspace <경로>\n` +
        `  모든 작품에 저장하려면 storyboard ${verb} --global`,
      mode,
      terminal.stderr,
    );
  }

  if (needsWorkspace && !isWorkspace) {
    return failure(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        '  새로 만들려면   storyboard init --title "작품 이름"\n' +
        '  다른 곳이라면   storyboard <명령> --workspace <경로>',
      mode,
      terminal.stderr,
    );
  }

  const reviseIterations: string | undefined = flagString(args.flags, 'revise-iterations');
  const showProgress: boolean =
    flagBoolean(args.flags, 'verbose') ||
    (deps.isInteractive && !mode.json && !flagBoolean(args.flags, 'quiet'));
  const logger: IStoryboardLogger = deps.createLogger(
    showProgress,
    terminal.stderr.theme,
    flagBoolean(args.flags, 'verbose'),
  );
  const usageSession: RunUsageReaders = {
    readCostUsd: (): number => 0,
    readUnpricedTokens: (): number => 0,
    readCacheHitRate: (): number | undefined => undefined,
  };
  const progress: IRunProgress =
    deps.liveArea !== undefined && showProgress && terminal.stderr.isTty && !mode.json
      ? new RailRunProgress({
          liveArea: deps.liveArea,
          theme: terminal.stderr.theme,
          readCostUsd: () => usageSession.readCostUsd(),
          readUnpricedTokens: () => usageSession.readUnpricedTokens(),
          readCacheHitRate: () => usageSession.readCacheHitRate(),
        })
      : new LineRunProgress(logger);
  const container: CliContainer = createCliContainer({
    workspacePath,
    logger,
    progress,
    ...(deps.pauseRequests === undefined ? {} : { pauseRequests: deps.pauseRequests }),
    ...(deps.createPrompter === undefined || mode.json
      ? {}
      : { prompter: deps.createPrompter(terminal.stderr) }),
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

    const resources: ResourceOverrideReport = await container.loadResourceOverrides();
    for (const problem of resources.problems) {
      container.logger.warn(problem.message);
    }
  }

  const shouldShowDraftChanges: boolean =
    spec?.rewritesDraft === true &&
    terminal.stderr.isTty &&
    !mode.json &&
    !flagBoolean(args.flags, 'quiet');
  const draftStem: string | undefined = args.positionals[0]?.replace(/\.card$/, '');
  const readDraftBody = async (): Promise<string | undefined> =>
    draftStem === undefined
      ? undefined
      : (await container.drafts.readDraft(container.workspaceRoot, draftStem))?.draft.body;
  const draftBefore: string | undefined = shouldShowDraftChanges
    ? await readDraftBody()
    : undefined;

  const meter: UsageMeterSession = container.usageMeter.startSession();
  usageSession.readCostUsd = (): number => meter.reading().costUsd;
  usageSession.readUnpricedTokens = (): number =>
    meter.reading().hasUnpricedUsage ? meter.reading().tokens : 0;
  usageSession.readCacheHitRate = (): number | undefined => usageCacheHitRate(meter.reading());

  const outcome: CommandOutcome = await runReportingProgress(progress, () =>
    spec?.writesWorkspace === true
      ? runHoldingWorkspaceLock(container, verb, () =>
          handler({ container, args, stdout: terminal.stdout }),
        )
      : handler({ container, args, stdout: terminal.stdout }),
  );
  meter.stop();

  const isAction: boolean = spec?.writesWorkspace === true || verb === 'init';
  const markedMessage: string = markOutcome(
    outcome.message,
    {
      ok: outcome.ok,
      isAction,
      ...(outcome.stop === undefined ? {} : { stop: outcome.stop }),
      ...(outcome.isDrawn === undefined ? {} : { isDrawn: outcome.isDrawn }),
    },
    terminal.stdout,
  );
  const stdout: string = mode.json
    ? reportText(outcome, mode)
    : `${terminal.stdout.isTty ? linkFilePaths(markedMessage, existsSync) : markedMessage}\n`;
  const shouldSuggestNextStep: boolean =
    outcome.ok &&
    outcome.stop === undefined &&
    isAction &&
    !mode.json &&
    terminal.stderr.isTty &&
    !flagBoolean(args.flags, 'quiet');

  const draftChanges: string =
    outcome.ok && draftBefore !== undefined && draftStem !== undefined
      ? renderDraftChanges(draftStem, draftBefore, await readDraftBody(), terminal.stderr)
      : '';

  return {
    exitCode: outcome.ok ? 0 : 1,
    costUsd: meter.reading().costUsd,
    stdout,
    stderr: `${draftChanges}${shouldSuggestNextStep ? await suggestNextStep(container, terminal.stderr) : ''}`,
    outcome,
  };
}

const hintOmittedSoTheFinishedRunStillSucceeds: string = '';

async function suggestNextStep(
  container: ReturnType<typeof createCliContainer>,
  stream: TerminalStream,
): Promise<string> {
  try {
    return renderNextStep(await container.describeWorkspace(), stream);
  } catch {
    return hintOmittedSoTheFinishedRunStillSucceeds;
  }
}

function renderDraftChanges(
  stem: string,
  before: string,
  after: string | undefined,
  stream: TerminalStream,
): string {
  if (after === undefined || after === before) {
    return '';
  }

  return `${renderSentenceDiff(`draft/${stem}.md`, diffSentences(before, after), stream.theme).join('\n')}\n`;
}

async function runReportingProgress(
  progress: IRunProgress,
  run: () => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  try {
    return await run();
  } finally {
    progress.finish();
  }
}

async function runHoldingWorkspaceLock(
  container: ReturnType<typeof createCliContainer>,
  verb: string,
  run: () => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
  const held: WorkspaceHoldResult<CommandOutcome> = await container.runGate.hold(
    container.workspaceRoot,
    `storyboard ${verb}`,
    run,
  );

  if (!held.ok) {
    return {
      ok: false,
      message: `${held.message}. 끝난 뒤 다시 실행하세요.`,
      data: { heldBy: held.heldBy },
    };
  }

  return held.value;
}
