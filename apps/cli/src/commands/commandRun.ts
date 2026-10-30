import { existsSync } from 'node:fs';
import { usageCacheHitRate } from '@storyboard/story-model';
import type { ConfigurationTarget } from '@storyboard/story-config';
import { type IStoryboardLogger, type UsageMeterSession } from '@storyboard/story-engine';
import type { ResourceOverrideReport, WorkspaceHoldResult } from '@storyboard/story-app';
import { flagBoolean, flagString } from '@/cliArguments';
import { LineRunProgress, RailRunProgress, type IRunProgress } from '@/adapters/runProgress';
import { createCliContainer, type CliContainer } from '@/container';
import type { TerminalStream } from '@/terminal/profile';
import { diffSentences, renderSentenceDiff } from '@/terminal/diff';
import { linkFilePaths } from '@/terminal/signals';
import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandOutcome } from '@/commands/outcome';
import { markOutcome, renderNextStep } from '@/commands/outcomeView';
import type {
  DispatchDependencies,
  DispatchResult,
  Invocation,
  OutputMode,
  WorkspaceTarget,
} from '@/commands/dispatchContract';

export function reportText(outcome: CommandOutcome, mode: OutputMode): string {
  if (mode.json) {
    return `${JSON.stringify({ ok: outcome.ok, message: outcome.message, data: outcome.data ?? null })}\n`;
  }

  return `${outcome.message}\n`;
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

interface DraftSnapshot {
  readonly stem: string;
  readonly body: string;
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

export interface CommandRunDependencies {
  readonly command: ICommandHandler;
  readonly invocation: Invocation;
  readonly target: WorkspaceTarget;
  readonly dispatch: DispatchDependencies;
}

const hintOmittedSoTheFinishedRunStillSucceeds: string = '';

export class CommandRun {
  private readonly usageRelay: RunUsageRelay = new RunUsageRelay();
  private readonly logger: IStoryboardLogger;
  private readonly progress: IRunProgress;
  private readonly container: CliContainer;

  public constructor(private readonly deps: CommandRunDependencies) {
    const showProgress: boolean = this.shouldShowProgress();
    this.logger = this.createLogger(showProgress);
    this.progress = this.createProgress(showProgress);
    this.container = this.createContainer();
  }

  public async execute(): Promise<DispatchResult> {
    if (this.deps.target.needsWorkspace) {
      await this.prepareWorkspace();
    }

    const draftSnapshot: DraftSnapshot | undefined = await this.snapshotDraft();
    const meter: UsageMeterSession = this.container.usageMeter.startSession();
    this.usageRelay.attach(meter);

    const outcome: CommandOutcome = await this.executeCommandReportingProgress();
    meter.stop();

    return this.buildCommandResult(outcome, meter.reading().costUsd, draftSnapshot);
  }

  private shouldShowProgress(): boolean {
    const { args, mode } = this.deps.invocation;

    return (
      flagBoolean(args.flags, 'verbose') ||
      (this.deps.dispatch.isInteractive && !mode.json && !flagBoolean(args.flags, 'quiet'))
    );
  }

  private createLogger(showProgress: boolean): IStoryboardLogger {
    const { args, terminal } = this.deps.invocation;

    return this.deps.dispatch.createLogger(
      showProgress,
      terminal.stderr.theme,
      flagBoolean(args.flags, 'verbose'),
    );
  }

  private createProgress(showProgress: boolean): IRunProgress {
    const { mode, terminal } = this.deps.invocation;
    const { liveArea } = this.deps.dispatch;

    return liveArea !== undefined && showProgress && terminal.stderr.isTty && !mode.json
      ? new RailRunProgress({
          liveArea,
          theme: terminal.stderr.theme,
          readCostUsd: this.usageRelay.readCostUsd,
          readUnpricedTokens: this.usageRelay.readUnpricedTokens,
          readCacheHitRate: this.usageRelay.readCacheHitRate,
        })
      : new LineRunProgress(this.logger);
  }

  private createContainer(): CliContainer {
    const { invocation, target, dispatch: deps } = this.deps;
    const { args, mode, terminal } = invocation;
    const reviseIterations: string | undefined = flagString(args.flags, 'revise-iterations');
    const configWriteTarget: ConfigurationTarget | undefined = target.configWriteTarget;

    return createCliContainer({
      workspacePath: target.workspacePath,
      logger: this.logger,
      progress: this.progress,
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

  private async prepareWorkspace(): Promise<void> {
    const { container } = this;

    const resources: ResourceOverrideReport = await container.workspace.prepare(
      container.workspaceRoot,
    );
    for (const problem of resources.problems) {
      container.logger.warn(problem.message);
    }
  }

  private async readDraftBody(stem: string): Promise<string | undefined> {
    return (await this.container.drafts.readDraft(this.container.workspaceRoot, stem))?.draft.body;
  }

  private async snapshotDraft(): Promise<DraftSnapshot | undefined> {
    const { args, mode, terminal } = this.deps.invocation;
    const shouldShowDraftChanges: boolean =
      this.deps.target.spec?.rewritesDraft === true &&
      terminal.stderr.isTty &&
      !mode.json &&
      !flagBoolean(args.flags, 'quiet');
    const stem: string | undefined = args.positionals[0]?.replace(/\.card$/, '');

    if (!shouldShowDraftChanges || stem === undefined) {
      return undefined;
    }

    const body: string | undefined = await this.readDraftBody(stem);
    return body === undefined ? undefined : { stem, body };
  }

  private async executeCommandReportingProgress(): Promise<CommandOutcome> {
    try {
      return await this.executeCommand();
    } finally {
      this.progress.finish();
    }
  }

  private executeCommand(): Promise<CommandOutcome> {
    const { command, invocation, target } = this.deps;
    const { args, terminal } = invocation;
    const { container } = this;

    return target.spec?.writesWorkspace === true
      ? this.runHoldingWorkspaceLock(() =>
          command.execute({ container, args, stdout: terminal.stdout }),
        )
      : command.execute({ container, args, stdout: terminal.stdout });
  }

  private async runHoldingWorkspaceLock(
    run: () => Promise<CommandOutcome>,
  ): Promise<CommandOutcome> {
    const held: WorkspaceHoldResult<CommandOutcome> = await this.container.runGate.hold(
      this.container.workspaceRoot,
      `storyboard ${this.deps.invocation.verb}`,
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

  private async buildCommandResult(
    outcome: CommandOutcome,
    costUsd: number,
    draftSnapshot: DraftSnapshot | undefined,
  ): Promise<DispatchResult> {
    const { invocation, target } = this.deps;
    const isAction: boolean = target.spec?.writesWorkspace === true || invocation.verb === 'init';
    const stdout: string = this.renderOutcomeStdout(outcome, isAction);
    const draftChanges: string = await this.describeDraftChanges(outcome, draftSnapshot);
    const nextStep: string = this.shouldSuggestNextStep(outcome, isAction)
      ? await this.suggestNextStep()
      : '';

    return {
      exitCode: outcome.ok ? 0 : 1,
      costUsd,
      stdout,
      stderr: `${draftChanges}${nextStep}`,
      outcome,
    };
  }

  private renderOutcomeStdout(outcome: CommandOutcome, isAction: boolean): string {
    const { mode, terminal } = this.deps.invocation;
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

  private async describeDraftChanges(
    outcome: CommandOutcome,
    snapshot: DraftSnapshot | undefined,
  ): Promise<string> {
    if (!outcome.ok || snapshot === undefined) {
      return '';
    }

    return renderDraftChanges(
      snapshot.stem,
      snapshot.body,
      await this.readDraftBody(snapshot.stem),
      this.deps.invocation.terminal.stderr,
    );
  }

  private shouldSuggestNextStep(outcome: CommandOutcome, isAction: boolean): boolean {
    const { args, mode, terminal } = this.deps.invocation;

    return (
      outcome.ok &&
      outcome.stop === undefined &&
      isAction &&
      !mode.json &&
      terminal.stderr.isTty &&
      !flagBoolean(args.flags, 'quiet')
    );
  }

  private async suggestNextStep(): Promise<string> {
    try {
      return renderNextStep(
        await this.container.describeWorkspace(),
        this.deps.invocation.terminal.stderr,
      );
    } catch {
      return hintOmittedSoTheFinishedRunStillSucceeds;
    }
  }
}
