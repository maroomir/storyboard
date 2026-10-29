import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  extractErrorMessage,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type ProviderModelOptions,
  type StoryboardSettingDefinition,
} from '@storyboard/story-model';

import { commandCatalog, findCommandSpec } from '@/commands/index';
import { PauseRequests } from '@/adapters/pauseRequests';
import {
  runShellCommand,
  type ShellCommandResult,
  type ShellCommandRun,
} from '@/adapters/shellCommand';
import { isScreenDrawing, keepTextAndColors } from '@/terminal/controlCodes';
import type { ChoiceRequest, TextRequest } from '@/adapters/prompter';
import { computeCompletions, listWorkspaceMentions, type Completion } from '@/commands/completion';
import { CommandDispatcher, type DispatchResult } from '@/commands/commandDispatcher';
import { renderGroupList, renderHelpTopic, suggestVerbs } from '@/help';

import { saveTuiThemeName, tuiThemeLabels, tuiThemeNames, type TuiThemeName } from './tuiTheme';
import { isWorkspace } from './workspaceView';
import { availableProviderIds } from '@/adapters/availableProviders';

export type LogTone = 'input' | 'progress' | 'result' | 'error' | 'hint';

export interface LogEntry {
  readonly id: number;
  readonly tone: LogTone;
  readonly text: string;
}

export interface TuiSessionOptions {
  readonly version: string;
  readonly cwd: string;
}

interface SlashCommand {
  readonly name: string;
  readonly summary: string;
}

export const slashCommands: readonly SlashCommand[] = [
  { name: '/help', summary: '명령 목록 · /help <명령> 은 그 명령의 옵션' },
  { name: '/doctor', summary: '설정·프로바이더·워크스페이스 점검' },
  { name: '/setup', summary: '기본 프로바이더 바꾸기 (/setup <id>)' },
  { name: '/model', summary: '프로바이더와 모델을 목록에서 고르기' },
  { name: '/config', summary: '설정 하나를 골라 값 바꾸기' },
  { name: '/theme', summary: '화면 색 테마 고르기' },
  { name: '/cost', summary: '이 화면에서 쓴 비용' },
  { name: '/clear', summary: '화면 비우기' },
  { name: '/quit', summary: '나가기 (Ctrl+C 도 됩니다)' },
];

export function splitCommandLine(line: string): string[] {
  const argv: string[] = [];
  let current: string = '';
  let quote: '"' | "'" | undefined;
  let hasToken: boolean = false;

  for (const char of line) {
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        argv.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) {
    argv.push(current);
  }

  return argv;
}

export interface InputSuggestion {
  readonly text: string;
  readonly summary: string;
  readonly line: string;
}

function isVerbOrVerbStart(words: string): boolean {
  return commandCatalog.some((spec) => spec.verb === words || spec.verb.startsWith(`${words} `));
}

export function suggestForInput(input: string, cwd: string = process.cwd()): InputSuggestion[] {
  const trimmed: string = input.trimStart();

  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('/')) {
    return slashCommands
      .filter((command) => command.name.startsWith(trimmed.split(/\s/)[0] ?? ''))
      .map((command) => ({
        text: command.name,
        summary: command.summary,
        line: `${command.name} `,
      }));
  }

  const words: string[] = splitCommandLine(trimmed);
  if (/\s$/.test(trimmed)) {
    words.push('');
  }

  const current: string = words[words.length - 1] ?? '';
  const head: string = trimmed.slice(0, trimmed.length - current.length);

  if (current.startsWith('@')) {
    const prefix: string = current.slice(1);
    return listWorkspaceMentions(cwd)
      .filter((mention) => mention.text.startsWith(prefix))
      .map((mention) => ({
        text: `@${mention.text}`,
        summary: mention.description,
        line: `${head}${mention.text} `,
      }));
  }
  const completions: Completion[] = computeCompletions(words, { cwd });

  if (completions.length > 0) {
    return completions.map((completion) => {
      const line: string = `${head}${completion.text}`;
      const text: string = isVerbOrVerbStart(line.trim()) ? line.trim() : completion.text;
      return { text, summary: completion.description, line: `${line} ` };
    });
  }

  const isTypingVerb: boolean = words.length <= 3 && !current.startsWith('-');
  return isTypingVerb
    ? suggestVerbs(trimmed.toLowerCase(), 5).map((verb) => ({
        text: verb,
        summary: findCommandSpec(verb)?.summary ?? '',
        line: `${verb} `,
      }))
    : [];
}

export function renderVerbList(): string {
  return [
    ...renderGroupList(),
    '',
    '  /help <묶음> 은 한 묶음의 명령, /help <명령> 은 한 명령의 옵션',
    '',
    '슬래시 명령',
    ...slashCommands.map((c) => `  ${c.name.padEnd(12)}${c.summary}`),
  ].join('\n');
}

export interface SpendingEntry {
  readonly line: string;
  readonly costUsd: number;
}

export function describeSpending(spending: readonly SpendingEntry[]): string {
  if (spending.length === 0) {
    return '이 화면에서 아직 비용이 든 명령이 없습니다.';
  }

  const total: number = spending.reduce((sum, entry) => sum + entry.costUsd, 0);
  return [
    ...spending.map((entry) => `$${entry.costUsd.toFixed(2).padStart(7)}  ${entry.line}`),
    `$${total.toFixed(2).padStart(7)}  합계`,
  ].join('\n');
}

export interface SessionSink {
  readonly append: (tone: LogTone, text: string) => void;
  readonly ask: <T>(request: ChoiceRequest<T>) => Promise<T | undefined>;
  readonly askText: (request: TextRequest) => Promise<string | undefined>;
  readonly setTheme: (name: TuiThemeName) => void;
  readonly openReader: (title: string, body: string) => void;
  readonly setEscapeHint: (hint: string | undefined) => void;
  readonly clear: () => void;
  readonly exit: () => void;
}

function createSessionLogger(sink: SessionSink): IStoryboardLogger {
  return {
    info: (message) => sink.append('progress', message),
    warn: (message) => sink.append('hint', `경고: ${message}`),
    error: (message, error) =>
      sink.append('error', error instanceof Error ? `${message} ${error.message}` : message),
    show: () => undefined,
  };
}

function describeShellOutput(result: ShellCommandResult): string {
  if (isScreenDrawing(result.output)) {
    return (
      '화면 전체를 그리는 프로그램은 여기서 실행할 수 없습니다. 터미널에서 직접 실행해 주세요. ' +
      `(종료 코드 ${result.exitCode})`
    );
  }

  const output: string = keepTextAndColors(result.output).trimEnd();
  return output.length > 0 ? output : `종료 코드 ${result.exitCode}`;
}

function describeResultTone(result: DispatchResult): LogTone {
  if (result.outcome?.stop !== undefined) {
    return 'hint';
  }
  return result.exitCode === 0 ? 'result' : 'error';
}

export interface TuiSession {
  readonly run: (line: string) => Promise<void>;
  readonly interrupt: () => string;
}

const canReadlineShareStdinWithTheScreen: boolean = false;

function isDraftShown(argv: readonly string[], dispatched: DispatchResult): boolean {
  return (
    argv[0] === 'draft' &&
    argv[1] === 'show' &&
    dispatched.exitCode === 0 &&
    !argv.includes('--json')
  );
}

class StoryboardTuiSession implements TuiSession {
  private pauseRequests: PauseRequests = new PauseRequests();
  private stopShellCommand: (() => void) | undefined = undefined;
  private readonly spending: SpendingEntry[] = [];

  public constructor(
    private readonly options: TuiSessionOptions,
    private readonly sink: SessionSink,
  ) {}

  public readonly interrupt = (): string => {
    if (this.stopShellCommand !== undefined) {
      this.stopShellCommand();
      return '셸 명령을 멈췄습니다.';
    }

    return this.pauseRequests.request()
      ? '지금 씬을 마치고 멈춥니다.'
      : '이 명령은 중간에 멈출 수 없습니다. 끝날 때까지 기다려 주세요.';
  };

  public readonly run = async (line: string): Promise<void> => {
    const trimmed: string = line.trim();

    if (trimmed.length === 0) {
      return;
    }

    this.sink.append('input', trimmed);

    if (trimmed.startsWith('!')) {
      await this.runShellCommand(trimmed.slice(1));
      return;
    }

    if (trimmed.startsWith('/')) {
      await this.runSlashCommand(trimmed);
      return;
    }

    await this.runCommandLine(trimmed);
  };

  private async runArgv(argv: readonly string[]): Promise<DispatchResult> {
    const { sink } = this;
    this.pauseRequests = new PauseRequests(() => sink.setEscapeHint('Esc 씬 경계에서 멈춤'));
    return new CommandDispatcher({
      version: this.options.version,
      cwd: this.options.cwd,
      isInteractive: canReadlineShareStdinWithTheScreen,
      createLogger: () => createSessionLogger(sink),
      pauseRequests: this.pauseRequests,
      createPrompter: () => ({
        shouldConfirmPaidRuns: true,
        choose: sink.ask,
        askText: sink.askText,
        announce: (line) => sink.append('hint', line),
      }),
    }).dispatch(argv);
  }

  private async runShellCommand(command: string): Promise<void> {
    const shellRun: ShellCommandRun = runShellCommand(command, this.options.cwd);
    this.stopShellCommand = shellRun.stop;
    this.sink.setEscapeHint('Esc 명령 중단');
    const shellOutcome: ShellCommandResult = await shellRun.result.finally(() => {
      this.stopShellCommand = undefined;
    });
    this.sink.append(
      shellOutcome.exitCode === 0 ? 'result' : 'error',
      describeShellOutput(shellOutcome),
    );
  }

  private async runSlashCommand(trimmed: string): Promise<void> {
    const [name, ...rest] = trimmed.split(/\s+/);

    switch (name) {
      case '/quit':
      case '/exit':
        this.sink.exit();
        return;
      case '/clear':
        this.sink.clear();
        return;
      case '/help':
        this.showHelp(rest.join(' '));
        return;
      case '/doctor':
        this.show(await this.runArgv(['doctor']));
        return;
      case '/setup':
        this.show(
          await this.runArgv(rest.length > 0 ? ['setup', '--provider', rest[0] ?? ''] : ['setup']),
        );
        return;
      case '/model':
        await this.chooseModel();
        return;
      case '/config':
        await this.chooseSetting();
        return;
      case '/theme':
        await this.chooseTheme();
        return;
      case '/cost':
        this.sink.append('result', describeSpending(this.spending));
        return;
      default:
        this.sink.append('error', `모르는 슬래시 명령: ${name} — /help 를 보세요.`);
        return;
    }
  }

  private showHelp(topic: string): void {
    this.sink.append(
      'result',
      topic.length > 0 ? (renderHelpTopic(topic) ?? `모르는 명령: ${topic}`) : renderVerbList(),
    );
  }

  private async runCommandLine(trimmed: string): Promise<void> {
    const argv: string[] = splitCommandLine(trimmed);

    try {
      const dispatched: DispatchResult = await this.runArgv(
        argv.map((token) => (token.startsWith('@') ? token.slice(1) : token)),
      );
      if ((dispatched.costUsd ?? 0) > 0) {
        this.spending.push({ line: trimmed, costUsd: dispatched.costUsd ?? 0 });
      }

      if (isDraftShown(argv, dispatched)) {
        this.sink.openReader(`draft/${(argv[2] ?? '').replace(/^@/, '')}.md`, dispatched.stdout);
        return;
      }

      this.show(dispatched);
    } catch (error) {
      this.sink.append('error', extractErrorMessage(error));
    }
  }

  private async setConfig(key: string, value: string): Promise<void> {
    const scope: string[] = isWorkspace(this.options.cwd) ? [] : ['--global'];
    this.show(await this.runArgv(['config', 'set', key, value, ...scope]));
  }

  private async chooseModel(): Promise<void> {
    const provider: AiProviderId | undefined = await this.sink.ask({
      title: '프로바이더',
      details: [],
      options: availableProviderIds().map((id) => ({ label: id, value: id })),
    });
    if (provider === undefined) {
      return;
    }

    const models: ProviderModelOptions = storyboardModelCatalog[provider];
    const model: string | undefined =
      models.length > 0
        ? await this.sink.ask({
            title: `${provider} 모델`,
            details: [],
            options: models.map((entry) => ({ label: entry.displayName, value: entry.id })),
          })
        : await this.sink.askText({ title: `${provider} 모델 이름` });
    if (model === undefined || model.length === 0) {
      return;
    }

    await this.setConfig('ai.provider.default', provider);
    await this.setConfig(`providers.${provider}.model`, model);
  }

  private async chooseSetting(): Promise<void> {
    const definition: StoryboardSettingDefinition | undefined = await this.sink.ask({
      title: '설정',
      details: ['값을 바꿀 설정을 고르세요'],
      options: storyboardSettingCatalog.map((entry) => ({
        label: `${entry.label} (${entry.key})`,
        value: entry,
      })),
    });
    if (definition === undefined) {
      return;
    }

    const value: string | undefined = await this.askSettingValue(definition);
    if (value === undefined || value.length === 0) {
      return;
    }

    await this.setConfig(definition.key, value);
  }

  private async askSettingValue(
    definition: StoryboardSettingDefinition,
  ): Promise<string | undefined> {
    return definition.kind === 'boolean'
      ? await this.sink.ask({
          title: definition.label,
          details: [definition.description],
          options: [
            { label: '켜기', value: 'true' },
            { label: '끄기', value: 'false' },
          ],
        })
      : await this.sink.askText({
          title: definition.label,
          hint: `기본 ${String(definition.defaultValue)}`,
        });
  }

  private async chooseTheme(): Promise<void> {
    const theme: TuiThemeName | undefined = await this.sink.ask({
      title: '색 테마',
      details: [],
      options: tuiThemeNames.map((themeName) => ({
        label: tuiThemeLabels[themeName],
        value: themeName,
      })),
    });
    if (theme === undefined) {
      return;
    }

    this.sink.setTheme(theme);
    saveTuiThemeName(theme);
    this.sink.append('result', `테마를 «${tuiThemeLabels[theme]}» 로 바꿨습니다.`);
  }

  private show(result: DispatchResult): void {
    const text: string = (result.stdout + result.stderr).trimEnd();

    if (text.length > 0) {
      this.sink.append(describeResultTone(result), text);
    }
  }
}

export function createTuiSession(options: TuiSessionOptions, sink: SessionSink): TuiSession {
  return new StoryboardTuiSession(options, sink);
}
