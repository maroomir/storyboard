import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  aiProviderIds,
  storyboardModelCatalog,
  storyboardSettingCatalog,
} from '@storyboard/story-model';

import { commandCatalog, findCommandSpec } from '@/commands/catalog';
import { PauseRequests } from '@/adapters/pauseRequests';
import { runShellCommand } from '@/adapters/shellCommand';
import type { ChoiceRequest, TextRequest } from '@/adapters/prompter';
import { computeCompletions, listWorkspaceMentions } from '@/commands/completion';
import { dispatch, type DispatchResult } from '@/commands/dispatch';
import { renderGroupList, renderHelpTopic, suggestVerbs } from '@/help';

import { saveTuiThemeName, tuiThemeLabels, tuiThemeNames, type TuiThemeName } from './tuiTheme';
import { isWorkspace } from './workspaceView';

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

// Splits a typed line into argv the same way a POSIX shell would for quotes, so
// `init --title "밤의 항해"` reaches the parser as one title.
export function splitCommandLine(line: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let hasToken = false;

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
  // What the list shows: a whole verb while the verb is being typed, otherwise the one token.
  readonly text: string;
  readonly summary: string;
  // The input line once this suggestion is taken; only the token under the cursor changes.
  readonly line: string;
}

function isVerbOrVerbStart(words: string): boolean {
  return commandCatalog.some((spec) => spec.verb === words || spec.verb.startsWith(`${words} `));
}

// What the composer proposes while the author types: slash commands for a leading `/`; otherwise
// what shell completion would offer for the last word (verb words, flags, scene stems, card ids),
// and for a verb nothing starts with, the verbs it most resembles.
export function suggestForInput(input: string, cwd: string = process.cwd()): InputSuggestion[] {
  const trimmed = input.trimStart();

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

  const words = splitCommandLine(trimmed);
  if (/\s$/.test(trimmed)) {
    words.push('');
  }

  const current = words[words.length - 1] ?? '';
  const head = trimmed.slice(0, trimmed.length - current.length);

  if (current.startsWith('@')) {
    const prefix = current.slice(1);
    return listWorkspaceMentions(cwd)
      .filter((mention) => mention.text.startsWith(prefix))
      .map((mention) => ({
        text: `@${mention.text}`,
        summary: mention.description,
        line: `${head}${mention.text} `,
      }));
  }
  const completions = computeCompletions(words, { cwd });

  if (completions.length > 0) {
    return completions.map((completion) => {
      const line = `${head}${completion.text}`;
      const text = isVerbOrVerbStart(line.trim()) ? line.trim() : completion.text;
      return { text, summary: completion.description, line: `${line} ` };
    });
  }

  const isTypingVerb = words.length <= 3 && !current.startsWith('-');
  return isTypingVerb
    ? suggestVerbs(trimmed.toLowerCase(), 5).map((verb) => ({
        text: verb,
        summary: findCommandSpec(verb)?.summary ?? '',
        line: `${verb} `,
      }))
    : [];
}

// The prompt takes a command without the `storyboard` prefix, so the list says how to drill in
// rather than repeating the shell form.
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

// What this screen has spent, command by command. The CLI keeps no ledger across runs, so the
// screen's own record is the only total there is.
export function describeSpending(spending: readonly SpendingEntry[]): string {
  if (spending.length === 0) {
    return '이 화면에서 아직 비용이 든 명령이 없습니다.';
  }

  const total = spending.reduce((sum, entry) => sum + entry.costUsd, 0);
  return [
    ...spending.map((entry) => `$${entry.costUsd.toFixed(2).padStart(7)}  ${entry.line}`),
    `$${total.toFixed(2).padStart(7)}  합계`,
  ].join('\n');
}

export interface SessionSink {
  readonly append: (tone: LogTone, text: string) => void;
  // Shows a question over the prompt and settles with the answer.
  readonly ask: <T>(request: ChoiceRequest<T>) => Promise<T | undefined>;
  readonly askText: (request: TextRequest) => Promise<string | undefined>;
  readonly setTheme: (name: TuiThemeName) => void;
  // Opens a draft in the reader instead of the log.
  readonly openReader: (title: string, body: string) => void;
  // What Esc does in the running command, for the status line; undefined when it does nothing.
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

// A run the author stopped is neither a result nor an error.
function describeResultTone(result: DispatchResult): LogTone {
  if (result.outcome?.stop !== undefined) {
    return 'hint';
  }
  return result.exitCode === 0 ? 'result' : 'error';
}

export interface TuiSession {
  readonly run: (line: string) => Promise<void>;
  // Esc during a run: stops a shell command, or a batch at the next scene boundary. Returns what
  // happened, for the log.
  readonly interrupt: () => string;
}

// Everything typed at the prompt goes through the same `dispatch` the one-shot CLI uses; the TUI
// only decides how to show what comes back.
export function createTuiSession(options: TuiSessionOptions, sink: SessionSink): TuiSession {
  // One per command, so a pause asked for one run never carries into the next.
  let pauseRequests = new PauseRequests();
  let stopShellCommand: (() => void) | undefined;

  const runArgv = async (argv: readonly string[]): Promise<DispatchResult> => {
    pauseRequests = new PauseRequests(() => sink.setEscapeHint('Esc 씬 경계에서 멈춤'));
    return dispatch(argv, {
      version: options.version,
      cwd: options.cwd,
      // Progress belongs in the log, but readline prompts would fight the screen for stdin.
      isInteractive: false,
      createLogger: () => createSessionLogger(sink),
      pauseRequests,
      createPrompter: () => ({
        shouldConfirmPaidRuns: true,
        choose: sink.ask,
        askText: sink.askText,
        announce: (line) => sink.append('hint', line),
      }),
    });
  };

  const spending: SpendingEntry[] = [];

  // Settings go through `config set`, so the screen writes exactly what the shell would: this
  // work's file inside a workspace, the shared home file outside one.
  const setConfig = async (key: string, value: string): Promise<void> => {
    const scope = isWorkspace(options.cwd) ? [] : ['--global'];
    show(await runArgv(['config', 'set', key, value, ...scope]));
  };

  const chooseModel = async (): Promise<void> => {
    const provider = await sink.ask({
      title: '프로바이더',
      details: [],
      options: aiProviderIds.map((id) => ({ label: id, value: id })),
    });
    if (provider === undefined) {
      return;
    }

    const models = storyboardModelCatalog[provider];
    const model =
      models.length > 0
        ? await sink.ask({
            title: `${provider} 모델`,
            details: [],
            options: models.map((entry) => ({ label: entry.displayName, value: entry.id })),
          })
        : await sink.askText({ title: `${provider} 모델 이름` });
    if (model === undefined || model.length === 0) {
      return;
    }

    await setConfig('ai.provider.default', provider);
    await setConfig(`providers.${provider}.model`, model);
  };

  const chooseSetting = async (): Promise<void> => {
    const definition = await sink.ask({
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

    const value =
      definition.kind === 'boolean'
        ? await sink.ask({
            title: definition.label,
            details: [definition.description],
            options: [
              { label: '켜기', value: 'true' },
              { label: '끄기', value: 'false' },
            ],
          })
        : await sink.askText({
            title: definition.label,
            hint: `기본 ${String(definition.defaultValue)}`,
          });
    if (value === undefined || value.length === 0) {
      return;
    }

    await setConfig(definition.key, value);
  };

  const chooseTheme = async (): Promise<void> => {
    const theme = await sink.ask({
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

    sink.setTheme(theme);
    saveTuiThemeName(theme);
    sink.append('result', `테마를 «${tuiThemeLabels[theme]}» 로 바꿨습니다.`);
  };

  const show = (result: DispatchResult): void => {
    const text = (result.stdout + result.stderr).trimEnd();

    if (text.length > 0) {
      sink.append(describeResultTone(result), text);
    }
  };

  return {
    interrupt: () => {
      if (stopShellCommand !== undefined) {
        stopShellCommand();
        return '셸 명령을 멈췄습니다.';
      }

      return pauseRequests.request()
        ? '지금 씬을 마치고 멈춥니다.'
        : '이 명령은 중간에 멈출 수 없습니다. 끝날 때까지 기다려 주세요.';
    },
    run: async (line: string): Promise<void> => {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        return;
      }

      sink.append('input', trimmed);

      if (trimmed.startsWith('!')) {
        const shellRun = runShellCommand(trimmed.slice(1), options.cwd);
        stopShellCommand = shellRun.stop;
        sink.setEscapeHint('Esc 명령 중단');
        const result = await shellRun.result.finally(() => {
          stopShellCommand = undefined;
        });
        const output = result.output.trimEnd();
        sink.append(
          result.exitCode === 0 ? 'result' : 'error',
          output.length > 0 ? output : `종료 코드 ${result.exitCode}`,
        );
        return;
      }

      if (trimmed.startsWith('/')) {
        const [name, ...rest] = trimmed.split(/\s+/);

        switch (name) {
          case '/quit':
          case '/exit':
            sink.exit();
            return;
          case '/clear':
            sink.clear();
            return;
          case '/help': {
            const topic = rest.join(' ');
            sink.append(
              'result',
              topic.length > 0
                ? (renderHelpTopic(topic) ?? `모르는 명령: ${topic}`)
                : renderVerbList(),
            );
            return;
          }
          case '/doctor':
            show(await runArgv(['doctor']));
            return;
          case '/setup':
            show(
              await runArgv(rest.length > 0 ? ['setup', '--provider', rest[0] ?? ''] : ['setup']),
            );
            return;
          case '/model':
            await chooseModel();
            return;
          case '/config':
            await chooseSetting();
            return;
          case '/theme':
            await chooseTheme();
            return;
          case '/cost':
            sink.append('result', describeSpending(spending));
            return;
          default:
            sink.append('error', `모르는 슬래시 명령: ${name} — /help 를 보세요.`);
            return;
        }
      }

      const argv = splitCommandLine(trimmed);

      try {
        // `@01-a` names the scene 01-a; the mark only told the composer what to suggest.
        const result = await runArgv(
          argv.map((token) => (token.startsWith('@') ? token.slice(1) : token)),
        );
        if ((result.costUsd ?? 0) > 0) {
          spending.push({ line: trimmed, costUsd: result.costUsd ?? 0 });
        }

        // A draft is read, not scanned: it opens in the reader rather than folding into the log.
        const isDraftShown =
          argv[0] === 'draft' &&
          argv[1] === 'show' &&
          result.exitCode === 0 &&
          !argv.includes('--json');
        if (isDraftShown) {
          sink.openReader(`draft/${(argv[2] ?? '').replace(/^@/, '')}.md`, result.stdout);
          return;
        }

        show(result);
      } catch (error) {
        sink.append('error', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
