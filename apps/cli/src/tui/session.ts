import type { IStoryboardLogger } from '@storyboard/story-engine';

import { commandCatalog, findCommandSpec } from '@/commands/catalog';
import { PauseRequests } from '@/adapters/pauseRequests';
import type { ChoiceRequest } from '@/adapters/prompter';
import { computeCompletions } from '@/commands/completion';
import { dispatch, type DispatchResult } from '@/commands/dispatch';
import { renderGroupList, renderHelpTopic, suggestVerbs } from '@/help';

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

export interface SessionSink {
  readonly append: (tone: LogTone, text: string) => void;
  // Shows a question over the prompt and settles with the answer.
  readonly ask: <T>(request: ChoiceRequest<T>) => Promise<T | undefined>;
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

export interface TuiSession {
  readonly run: (line: string) => Promise<void>;
  // Esc during a run: stop at the next scene boundary. False when the running command cannot.
  readonly requestPause: () => boolean;
}

// Everything typed at the prompt goes through the same `dispatch` the one-shot CLI uses; the TUI
// only decides how to show what comes back.
export function createTuiSession(options: TuiSessionOptions, sink: SessionSink): TuiSession {
  // One per command, so a pause asked for one run never carries into the next.
  let pauseRequests = new PauseRequests();

  const runArgv = async (argv: readonly string[]): Promise<DispatchResult> => {
    pauseRequests = new PauseRequests();
    return dispatch(argv, {
      version: options.version,
      cwd: options.cwd,
      // Progress belongs in the log, but readline prompts would fight the screen for stdin.
      isInteractive: false,
      createLogger: () => createSessionLogger(sink),
      pauseRequests,
      createPrompter: () => ({ shouldConfirmPaidRuns: true, choose: sink.ask }),
    });
  };

  const show = (result: DispatchResult): void => {
    const text = (result.stdout + result.stderr).trimEnd();

    if (text.length > 0) {
      sink.append(result.exitCode === 0 ? 'result' : 'error', text);
    }
  };

  return {
    requestPause: () => pauseRequests.request(),
    run: async (line: string): Promise<void> => {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        return;
      }

      sink.append('input', trimmed);

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
          default:
            sink.append('error', `모르는 슬래시 명령: ${name} — /help 를 보세요.`);
            return;
        }
      }

      const argv = splitCommandLine(trimmed);

      try {
        show(await runArgv(argv.map((token) => (token === '--verbose' ? '--verbose' : token))));
      } catch (error) {
        sink.append('error', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
