import { createInterface, type Interface } from 'node:readline/promises';

import { renderBox } from '@/terminal/layout';
import type { TerminalStream } from '@/terminal/profile';
import { wrapToWidth } from '@/terminal/width';

import { liveAreaReservedColumns, type LiveArea } from './liveArea';

const eraseAnsweredQuestionLine: string = '\u001b[1A\u001b[2K';

export interface ChoiceOption<T> {
  readonly label: string;
  readonly value: T;
}

export interface ChoiceRequest<T> {
  readonly title: string;
  readonly details: readonly string[];
  readonly options: readonly ChoiceOption<T>[];
}

export interface TextRequest {
  readonly title: string;
  readonly hint?: string;
}

export interface IPrompter {
  choose<T>(request: ChoiceRequest<T>): Promise<T | undefined>;
  askText(request: TextRequest): Promise<string | undefined>;
  announce(line: string): void;
  readonly shouldConfirmPaidRuns: boolean;
}

export function describeChoiceLines<T>(
  request: ChoiceRequest<T>,
  selectedIndex: number,
  stream: TerminalStream,
): string[] {
  const { paint } = stream.theme;
  const options: string[] = request.options.map((option, index) =>
    index === selectedIndex
      ? paint('accent', `❯ ${index + 1}. ${option.label}`)
      : `  ${index + 1}. ${option.label}`,
  );

  return [
    ...renderBox([...request.details, ...(request.details.length > 0 ? [''] : []), ...options], {
      availableWidth: stream.columns - liveAreaReservedColumns,
      title: request.title,
      paintFrame: (text) => paint('muted', text),
      paintTitle: (text) => paint('heading', text),
    }),
    ...wrapToWidth('↑↓ 또는 숫자로 고르고 Enter · Esc 취소', stream.columns - 3).map((line) =>
      paint('muted', `  ${line}`),
    ),
  ];
}

interface TerminalKeySequences {
  readonly up: string;
  readonly down: string;
  readonly enter: string;
  readonly escape: string;
  readonly interrupt: string;
}

const keys: TerminalKeySequences = {
  up: '\u001b[A',
  down: '\u001b[B',
  enter: '\r',
  escape: '\u001b',
  interrupt: '\u0003',
};

export interface KeyInput {
  readonly isRaw?: boolean;
  setRawMode(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export class TerminalPrompter implements IPrompter {
  public readonly shouldConfirmPaidRuns: boolean = false;

  public constructor(
    private readonly input: KeyInput,
    private readonly liveArea: LiveArea,
    private readonly stream: TerminalStream,
  ) {}

  public announce(line: string): void {
    this.liveArea.writeAbove(`${line}\n`);
  }

  public async askText(request: TextRequest): Promise<string | undefined> {
    const { paint } = this.stream.theme;
    const hint: string = request.hint === undefined ? '' : paint('muted', ` (${request.hint})`);
    const readline: Interface = createInterface({ input: process.stdin, output: process.stderr });
    const backOut: AbortController = new AbortController();
    const backOutOnEscape = (_text: unknown, key: { readonly name?: string } | undefined): void => {
      if (key?.name === 'escape') {
        backOut.abort();
      }
    };
    readline.on('SIGINT', () => backOut.abort());
    readline.on('close', () => backOut.abort());
    process.stdin.on('keypress', backOutOnEscape);

    try {
      const answer: string = await readline.question(
        `${paint('accent', '◆')}  ${request.title}${hint}  › `,
        { signal: backOut.signal },
      );
      process.stderr.write(eraseAnsweredQuestionLine);
      return answer.trim();
    } catch {
      process.stderr.write('\n');
      return undefined;
    } finally {
      process.stdin.off('keypress', backOutOnEscape);
      readline.close();
    }
  }

  public choose<T>(request: ChoiceRequest<T>): Promise<T | undefined> {
    let selectedIndex: number = 0;
    const wasRaw: boolean = this.input.isRaw ?? false;
    const draw = (): void =>
      this.liveArea.show(describeChoiceLines(request, selectedIndex, this.stream));

    return new Promise((resolve) => {
      const finish = (value: T | undefined): void => {
        this.input.off('data', onData);
        this.input.setRawMode(wasRaw);
        this.input.pause();
        this.liveArea.clear();
        resolve(value);
      };

      const onData = (chunk: Buffer | string): void => {
        const key: string = chunk.toString();
        const digit: number = Number.parseInt(key, 10);

        if (key === keys.escape || key === keys.interrupt) {
          finish(undefined);
        } else if (key === keys.enter) {
          finish(request.options[selectedIndex]?.value);
        } else if (key === keys.up || key === keys.down) {
          const step: 1 | -1 = key === keys.up ? -1 : 1;
          selectedIndex = (selectedIndex + step + request.options.length) % request.options.length;
          draw();
        } else if (digit >= 1 && digit <= request.options.length) {
          finish(request.options[digit - 1]?.value);
        }
      };

      this.input.setRawMode(true);
      this.input.resume();
      this.input.on('data', onData);
      draw();
    });
  }
}
