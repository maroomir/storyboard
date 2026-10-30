import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  storyboardModelCatalog,
  type AiProviderId,
  STORYBOARD_RELATIVE_PATHS,
  type ProviderModelOptions,
} from '@storyboard/story-model';
import { configurationTargets, type ConfigurationTarget } from '@storyboard/story-config';
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
import {
  createTerminalProfile,
  plainTerminalFacts,
  type TerminalProfile,
  type TerminalStream,
} from '@/terminal/profile';
import {
  renderCommandHelp,
  renderFullUsage,
  renderHelpTopic,
  renderUnknownCommand,
  renderUnknownFlag,
  renderUsage,
} from '@/help';
import type { CommandSpec } from '@/commands/catalog';
import {
  completionShells,
  computeCompletions,
  formatCompletions,
  renderCompletionScript,
  type Completion,
} from '@/commands/completion';
import { findCommand, findCommandSpec, commands } from '@/commands/index';
import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandOutcome } from '@/commands/outcome';
import { markOutcome } from '@/commands/outcomeView';
import { availableProviderIds } from '@/adapters/availableProviders';
import { CommandRun, reportText } from '@/commands/commandRun';
import type {
  DispatchDependencies,
  DispatchResult,
  Invocation,
  OutputMode,
  WorkspaceTarget,
} from '@/commands/dispatchContract';

export type { DispatchDependencies, DispatchResult } from '@/commands/dispatchContract';

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

    return new CommandRun({ command, invocation, target, dispatch: this.deps }).execute();
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
}
