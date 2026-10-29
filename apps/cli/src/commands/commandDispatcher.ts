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
  type IStoryboardLogger,
  type UsageMeterSession,
  WorkspaceInitializer,
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
import type { CommandSpec } from './catalog';
import {
  completionShells,
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
  type Completion,
} from './completion';
import { findCommand, findCommandSpec, commands } from './index';
import type { ICommandHandler } from './commandHandler';
import type { CommandOutcome } from './outcome';
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

interface Invocation {
  readonly argv: readonly string[];
  readonly args: ParsedArguments;
  readonly verb: string;
  readonly mode: OutputMode;
  readonly terminal: TerminalProfile;
}

interface WorkspaceTarget {
  readonly workspacePath: string;
  readonly spec: CommandSpec | undefined;
  readonly needsWorkspace: boolean;
  readonly isWorkspace: boolean;
  readonly configWriteTarget: ConfigurationTarget | undefined;
}

interface DraftSnapshot {
  readonly stem: string;
  readonly body: string;
}

interface FinishedCommandRun {
  readonly invocation: Invocation;
  readonly spec: CommandSpec | undefined;
  readonly container: CliContainer;
  readonly outcome: CommandOutcome;
  readonly costUsd: number;
  readonly draftSnapshot: DraftSnapshot | undefined;
}

class RunUsageRelay {
  private meter: UsageMeterSession | undefined = undefined;

  public attach(meter: UsageMeterSession): void {
    this.meter = meter;
  }

  public readonly readCostUsd = (): number =>
    this.meter === undefined ? 0 : this.meter.reading().costUsd;

  public readonly readUnpricedTokens = (): number => {
    if (this.meter === undefined) {
      return 0;
    }

    return this.meter.reading().hasUnpricedUsage ? this.meter.reading().tokens : 0;
  };

  public readonly readCacheHitRate = (): number | undefined =>
    this.meter === undefined ? undefined : usageCacheHitRate(this.meter.reading());
}

function describeParseFailure(parsed: ParseFailure): string {
  return parsed.unknownFlag === undefined
    ? `${parsed.message}\n전체 옵션: storyboard --help`
    : renderUnknownFlag(parsed.unknownFlag);
}

function renderCompletionVerb(invocation: Invocation): DispatchResult {
  const script: string | undefined = renderCompletionScript(invocation.args.positionals[0] ?? '');

  return script === undefined
    ? failure(
        `셸을 지정해 주세요: storyboard completion <${completionShells.join('|')}>`,
        invocation.mode,
        invocation.terminal.stderr,
      )
    : { exitCode: 0, stdout: script, stderr: '' };
}

function describeProviderRefusal(verb: string, args: ParsedArguments): string | undefined {
  const providerFailure: string | undefined =
    verb === 'config set'
      ? undefined
      : validateProvider(flagString(args.flags, 'provider'), flagString(args.flags, 'model'));

  if (
    (verb === 'config set' || verb === 'config unset') &&
    flagString(args.flags, 'provider') !== undefined
  ) {
    return (
      `--provider 는 이번 실행에 쓸 프로바이더를 정하는 옵션이라 ${verb} 과 함께 쓸 수 없습니다.\n` +
      '  기본 프로바이더를 바꾸려면   storyboard config set ai.provider.default <프로바이더>'
    );
  }

  return providerFailure;
}

function describeWorkspaceRefusal(verb: string, target: WorkspaceTarget): string | undefined {
  if (target.configWriteTarget === undefined && configWritingVerbs.has(verb)) {
    return (
      `Storyboard 워크스페이스가 아닙니다: ${target.workspacePath}\n` +
      `  이 작품에 저장하려면   storyboard ${verb} --workspace <경로>\n` +
      `  모든 작품에 저장하려면 storyboard ${verb} --global`
    );
  }

  if (target.needsWorkspace && !target.isWorkspace) {
    return (
      `Storyboard 워크스페이스가 아닙니다: ${target.workspacePath}\n` +
      '  새로 만들려면   storyboard init --title "작품 이름"\n' +
      '  다른 곳이라면   storyboard <명령> --workspace <경로>'
    );
  }

  return undefined;
}

function renderOutcomeStdout(
  outcome: CommandOutcome,
  isAction: boolean,
  invocation: Invocation,
): string {
  const { mode, terminal } = invocation;
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

  return mode.json
    ? reportText(outcome, mode)
    : `${terminal.stdout.isTty ? linkFilePaths(markedMessage, existsSync) : markedMessage}\n`;
}

function shouldSuggestNextStep(
  outcome: CommandOutcome,
  isAction: boolean,
  invocation: Invocation,
): boolean {
  return (
    outcome.ok &&
    outcome.stop === undefined &&
    isAction &&
    !invocation.mode.json &&
    invocation.terminal.stderr.isTty &&
    !flagBoolean(invocation.args.flags, 'quiet')
  );
}

export class CommandDispatcher {
  public constructor(private readonly deps: DispatchDependencies) {}

  public async dispatch(argv: readonly string[]): Promise<DispatchResult> {
    if (argv[0] === '__complete') {
      return this.completeWords(argv.slice(1));
    }

    const parsed: RawArguments | ParseFailure = parseArguments(argv);
    const mode: OutputMode = { json: argv.includes('--json') };
    const terminal: TerminalProfile = createTerminalProfile(
      this.deps.terminal ?? plainTerminalFacts,
      { hasNoColorFlag: argv.includes('--no-color'), isJsonOutput: mode.json },
    );

    if (isParseFailure(parsed)) {
      return failure(describeParseFailure(parsed), mode, terminal.stderr);
    }

    const args: ParsedArguments = resolveVerb(parsed, [
      ...commands.map((command) => command.spec.verb),
      'help',
      'tui',
      'completion',
    ]);
    const invocation: Invocation = { argv, args, verb: args.path.join(' '), mode, terminal };

    return this.answerWithoutCommand(invocation) ?? (await this.dispatchCommand(invocation));
  }

  private completeWords(words: readonly string[]): DispatchResult {
    const completions: Completion[] = computeCompletions(words, { cwd: this.deps.cwd });
    const text: string = formatCompletions(completions);

    return { exitCode: 0, stdout: text.length > 0 ? `${text}\n` : '', stderr: '' };
  }

  private answerWithoutCommand(invocation: Invocation): DispatchResult | undefined {
    const { args, verb } = invocation;

    if (flagBoolean(args.flags, 'version')) {
      return { exitCode: 0, stdout: `${this.deps.version}\n`, stderr: '' };
    }

    if (this.shouldLaunchTui(invocation)) {
      return { exitCode: 0, stdout: '', stderr: '', launchTui: true };
    }

    if (args.path.length === 0 || verb === 'help') {
      return this.renderHelp(invocation);
    }

    return verb === 'completion' ? renderCompletionVerb(invocation) : undefined;
  }

  private shouldLaunchTui({ args, verb }: Invocation): boolean {
    return (
      verb === 'tui' ||
      (args.path.length === 0 && this.deps.isInteractive && !flagBoolean(args.flags, 'help'))
    );
  }

  private renderHelp({ args, verb, mode, terminal }: Invocation): DispatchResult {
    const topic: string = verb === 'help' ? args.positionals.join(' ') : '';

    if (topic.length > 0) {
      const topicHelp: string | undefined = renderHelpTopic(topic, terminal.stdout);
      return topicHelp === undefined
        ? failure(renderUnknownCommand(topic), mode, terminal.stderr)
        : { exitCode: 0, stdout: topicHelp, stderr: '' };
    }

    const usage: string = flagBoolean(args.flags, 'all')
      ? renderFullUsage(this.deps.version, terminal.stdout)
      : renderUsage(this.deps.version, terminal.stdout);
    return { exitCode: 0, stdout: usage, stderr: '' };
  }

  private async dispatchCommand(invocation: Invocation): Promise<DispatchResult> {
    const { argv, args, verb, mode, terminal } = invocation;
    const command: ICommandHandler | undefined = findCommand(verb);

    if (!command) {
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
          renderCommandHelp(verb, terminal.stdout) ??
          renderUsage(this.deps.version, terminal.stdout),
        stderr: '',
      };
    }

    const providerRefusal: string | undefined = describeProviderRefusal(verb, args);

    if (providerRefusal !== undefined) {
      return failure(providerRefusal, mode, terminal.stderr);
    }

    const target: WorkspaceTarget = this.resolveWorkspaceTarget(invocation);
    const workspaceRefusal: string | undefined = describeWorkspaceRefusal(verb, target);

    if (workspaceRefusal !== undefined) {
      return failure(workspaceRefusal, mode, terminal.stderr);
    }

    return this.runCommand(command, invocation, target);
  }

  private resolveWorkspaceTarget({ args, verb }: Invocation): WorkspaceTarget {
    const workspacePath: string = resolve(
      this.deps.cwd,
      flagString(args.flags, 'workspace') ?? '.',
    );
    const spec: CommandSpec | undefined = findCommandSpec(verb);
    const isWorkspace: boolean = existsSync(
      join(workspacePath, STORYBOARD_RELATIVE_PATHS.projectJson),
    );
    const configWriteTarget: ConfigurationTarget | undefined = configWritingVerbs.has(verb)
      ? resolveConfigWriteTarget(flagBoolean(args.flags, 'global'), isWorkspace)
      : undefined;

    return {
      workspacePath,
      spec,
      needsWorkspace: spec?.needsWorkspace !== false,
      isWorkspace,
      configWriteTarget,
    };
  }

  private async runCommand(
    command: ICommandHandler,
    invocation: Invocation,
    target: WorkspaceTarget,
  ): Promise<DispatchResult> {
    const usageRelay: RunUsageRelay = new RunUsageRelay();
    const showProgress: boolean = this.shouldShowProgress(invocation);
    const logger: IStoryboardLogger = this.createLogger(invocation, showProgress);
    const progress: IRunProgress = this.createProgress(
      invocation,
      showProgress,
      logger,
      usageRelay,
    );
    const container: CliContainer = this.createContainer(invocation, target, logger, progress);

    if (target.needsWorkspace) {
      await prepareWorkspace(container);
    }

    const draftSnapshot: DraftSnapshot | undefined = await snapshotDraft(
      invocation,
      target.spec,
      container,
    );
    const meter: UsageMeterSession = container.usageMeter.startSession();
    usageRelay.attach(meter);

    const outcome: CommandOutcome = await runReportingProgress(progress, () =>
      executeCommand(command, invocation, target.spec, container),
    );
    meter.stop();

    return buildCommandResult({
      invocation,
      spec: target.spec,
      container,
      outcome,
      costUsd: meter.reading().costUsd,
      draftSnapshot,
    });
  }

  private shouldShowProgress({ args, mode }: Invocation): boolean {
    return (
      flagBoolean(args.flags, 'verbose') ||
      (this.deps.isInteractive && !mode.json && !flagBoolean(args.flags, 'quiet'))
    );
  }

  private createLogger({ args, terminal }: Invocation, showProgress: boolean): IStoryboardLogger {
    return this.deps.createLogger(
      showProgress,
      terminal.stderr.theme,
      flagBoolean(args.flags, 'verbose'),
    );
  }

  private createProgress(
    { mode, terminal }: Invocation,
    showProgress: boolean,
    logger: IStoryboardLogger,
    usageRelay: RunUsageRelay,
  ): IRunProgress {
    return this.deps.liveArea !== undefined && showProgress && terminal.stderr.isTty && !mode.json
      ? new RailRunProgress({
          liveArea: this.deps.liveArea,
          theme: terminal.stderr.theme,
          readCostUsd: usageRelay.readCostUsd,
          readUnpricedTokens: usageRelay.readUnpricedTokens,
          readCacheHitRate: usageRelay.readCacheHitRate,
        })
      : new LineRunProgress(logger);
  }

  private createContainer(
    { args, mode, terminal }: Invocation,
    target: WorkspaceTarget,
    logger: IStoryboardLogger,
    progress: IRunProgress,
  ): CliContainer {
    const { deps } = this;
    const reviseIterations: string | undefined = flagString(args.flags, 'revise-iterations');
    const configWriteTarget: ConfigurationTarget | undefined = target.configWriteTarget;

    return createCliContainer({
      workspacePath: target.workspacePath,
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
  }
}

async function prepareWorkspace(container: CliContainer): Promise<void> {
  await new WorkspaceInitializer(container.fileSystem).migrateLegacyMemory(
    getStoryboardProjectPaths(container.workspaceRoot),
  );

  const resources: ResourceOverrideReport = await container.loadResourceOverrides();
  for (const problem of resources.problems) {
    container.logger.warn(problem.message);
  }
}

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  return (await container.drafts.readDraft(container.workspaceRoot, stem))?.draft.body;
}

async function snapshotDraft(
  { args, mode, terminal }: Invocation,
  spec: CommandSpec | undefined,
  container: CliContainer,
): Promise<DraftSnapshot | undefined> {
  const shouldShowDraftChanges: boolean =
    spec?.rewritesDraft === true &&
    terminal.stderr.isTty &&
    !mode.json &&
    !flagBoolean(args.flags, 'quiet');
  const stem: string | undefined = args.positionals[0]?.replace(/\.card$/, '');

  if (!shouldShowDraftChanges || stem === undefined) {
    return undefined;
  }

  const body: string | undefined = await readDraftBody(container, stem);
  return body === undefined ? undefined : { stem, body };
}

async function describeDraftChanges(
  outcome: CommandOutcome,
  snapshot: DraftSnapshot | undefined,
  container: CliContainer,
  stream: TerminalStream,
): Promise<string> {
  if (!outcome.ok || snapshot === undefined) {
    return '';
  }

  return renderDraftChanges(
    snapshot.stem,
    snapshot.body,
    await readDraftBody(container, snapshot.stem),
    stream,
  );
}

function executeCommand(
  command: ICommandHandler,
  { args, verb, terminal }: Invocation,
  spec: CommandSpec | undefined,
  container: CliContainer,
): Promise<CommandOutcome> {
  return spec?.writesWorkspace === true
    ? runHoldingWorkspaceLock(container, verb, () =>
        command.execute({ container, args, stdout: terminal.stdout }),
      )
    : command.execute({ container, args, stdout: terminal.stdout });
}

async function buildCommandResult(run: FinishedCommandRun): Promise<DispatchResult> {
  const { invocation, outcome, container } = run;
  const isAction: boolean = run.spec?.writesWorkspace === true || invocation.verb === 'init';
  const stdout: string = renderOutcomeStdout(outcome, isAction, invocation);
  const draftChanges: string = await describeDraftChanges(
    outcome,
    run.draftSnapshot,
    container,
    invocation.terminal.stderr,
  );
  const nextStep: string = shouldSuggestNextStep(outcome, isAction, invocation)
    ? await suggestNextStep(container, invocation.terminal.stderr)
    : '';

  return {
    exitCode: outcome.ok ? 0 : 1,
    costUsd: run.costUsd,
    stdout,
    stderr: `${draftChanges}${nextStep}`,
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
