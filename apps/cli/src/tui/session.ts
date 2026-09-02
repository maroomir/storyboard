import type { IStoryboardLogger } from '@storyboard/story-engine';

import { commandCatalog, commandGroups, findCommandSpec } from '@/commands/catalog';
import { dispatch, type DispatchResult } from '@/commands/dispatch';
import { renderCommandHelp, suggestVerbs } from '@/help';

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

// What the composer proposes while the author types: slash commands for a leading `/`, otherwise
// verbs that start with (or resemble) the words typed so far.
export function suggestForInput(
  input: string,
): ReadonlyArray<{ readonly text: string; readonly summary: string }> {
  const trimmed = input.trimStart();

  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('/')) {
    return slashCommands
      .filter((command) => command.name.startsWith(trimmed.split(/\s/)[0] ?? ''))
      .map((command) => ({ text: command.name, summary: command.summary }));
  }

  const lower = trimmed.toLowerCase();
  const prefixed = commandCatalog.filter((spec) => spec.verb.startsWith(lower));
  const pool = prefixed.length > 0 ? prefixed.map((spec) => spec.verb) : suggestVerbs(lower, 5);

  return pool.slice(0, 6).map((verb) => {
    const spec = findCommandSpec(verb);
    return { text: verb, summary: spec?.summary ?? '' };
  });
}

export function renderVerbList(): string {
  const lines: string[] = [];

  for (const group of commandGroups) {
    const specs = commandCatalog.filter((spec) => spec.group === group && spec.verb !== 'tui');
    if (specs.length === 0) {
      continue;
    }
    lines.push(group, ...specs.map((spec) => `  ${spec.usage.padEnd(34)}${spec.summary}`));
  }

  lines.push('', '슬래시 명령', ...slashCommands.map((c) => `  ${c.name.padEnd(12)}${c.summary}`));
  return lines.join('\n');
}

export interface SessionSink {
  readonly append: (tone: LogTone, text: string) => void;
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
}

// Everything typed at the prompt goes through the same `dispatch` the one-shot CLI uses; the TUI
// only decides how to show what comes back.
export function createTuiSession(options: TuiSessionOptions, sink: SessionSink): TuiSession {
  const runArgv = async (argv: readonly string[]): Promise<DispatchResult> =>
    dispatch(argv, {
      version: options.version,
      cwd: options.cwd,
      // Progress belongs in the log, but readline prompts would fight the screen for stdin.
      isInteractive: false,
      createLogger: () => createSessionLogger(sink),
    });

  const show = (result: DispatchResult): void => {
    const text = (result.stdout + result.stderr).trimEnd();

    if (text.length > 0) {
      sink.append(result.exitCode === 0 ? 'result' : 'error', text);
    }
  };

  return {
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
                ? (renderCommandHelp(topic) ?? `모르는 명령: ${topic}`)
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
