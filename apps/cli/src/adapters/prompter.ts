import { createInterface } from 'node:readline/promises';

import { renderBox } from '@/terminal/layout';
import type { TerminalStream } from '@/terminal/profile';
import { wrapToWidth } from '@/terminal/width';

import type { LiveArea } from './liveArea';

// 사람에게 고르게 하는 질문 하나. 한 번 실행하는 명령은 stderr 에 상자를 그리고 키를 읽고, 대화형
// 화면은 같은 질문을 자기 대화상자로 보여 준다.

export interface ChoiceOption<T> {
  readonly label: string;
  readonly value: T;
}

export interface ChoiceRequest<T> {
  readonly title: string;
  // What the person needs to decide: the estimate, the target, the model.
  readonly details: readonly string[];
  readonly options: readonly ChoiceOption<T>[];
}

export interface TextRequest {
  readonly title: string;
  // Shown beside the question: what an empty answer means, an example.
  readonly hint?: string;
}

export interface IPrompter {
  // Undefined when the person backed out (Esc, Ctrl+C).
  choose<T>(request: ChoiceRequest<T>): Promise<T | undefined>;
  // The typed line, trimmed; undefined when the person backed out.
  askText(request: TextRequest): Promise<string | undefined>;
  // A line that stays on screen between questions, such as a wizard's answered steps.
  announce(line: string): void;
  // The interactive screen asks before a paid batch run; a one-shot command was started on
  // purpose and does not.
  readonly shouldConfirmPaidRuns: boolean;
}

export function describeChoiceLines<T>(
  request: ChoiceRequest<T>,
  selectedIndex: number,
  stream: TerminalStream,
): string[] {
  const { paint } = stream.theme;
  const options = request.options.map((option, index) =>
    index === selectedIndex
      ? paint('accent', `❯ ${index + 1}. ${option.label}`)
      : `  ${index + 1}. ${option.label}`,
  );

  return [
    ...renderBox([...request.details, ...(request.details.length > 0 ? [''] : []), ...options], {
      // The live area keeps the last column free so a line never wraps; a full-width frame would
      // lose its right edge there.
      availableWidth: stream.columns - 1,
      title: request.title,
      paintFrame: (text) => paint('muted', text),
      paintTitle: (text) => paint('heading', text),
    }),
    ...wrapToWidth('↑↓ 또는 숫자로 고르고 Enter · Esc 취소', stream.columns - 3).map((line) =>
      paint('muted', `  ${line}`),
    ),
  ];
}

const keys = {
  up: '\u001b[A',
  down: '\u001b[B',
  enter: '\r',
  escape: '\u001b',
  interrupt: '\u0003',
} as const;

export interface KeyInput {
  readonly isRaw?: boolean;
  setRawMode(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

// Draws the choice in the live area at the bottom of stderr and reads keys from a raw stdin.
export class TerminalPrompter implements IPrompter {
  public readonly shouldConfirmPaidRuns = false;

  public constructor(
    private readonly input: KeyInput,
    private readonly liveArea: LiveArea,
    private readonly stream: TerminalStream,
  ) {}

  public announce(line: string): void {
    this.liveArea.writeAbove(`${line}\n`);
  }

  // A cooked-mode line on the process's stdin, so the terminal's own editing and the IME handle
  // Hangul input. Esc, Ctrl+C and Ctrl+D back out, as Esc and Ctrl+C do in a choice box.
  public async askText(request: TextRequest): Promise<string | undefined> {
    const { paint } = this.stream.theme;
    const hint = request.hint === undefined ? '' : paint('muted', ` (${request.hint})`);
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    const backOut = new AbortController();
    const backOutOnEscape = (_text: unknown, key: { readonly name?: string } | undefined): void => {
      if (key?.name === 'escape') {
        backOut.abort();
      }
    };
    readline.on('SIGINT', () => backOut.abort());
    readline.on('close', () => backOut.abort());
    process.stdin.on('keypress', backOutOnEscape);

    try {
      const answer = await readline.question(
        `${paint('accent', '◆')}  ${request.title}${hint}  › `,
        { signal: backOut.signal },
      );
      // The answered question line gives way to the caller's own record of the step.
      process.stderr.write('\u001b[1A\u001b[2K');
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
    let selectedIndex = 0;
    const wasRaw = this.input.isRaw ?? false;
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
        const key = chunk.toString();
        const digit = Number.parseInt(key, 10);

        if (key === keys.escape || key === keys.interrupt) {
          finish(undefined);
        } else if (key === keys.enter) {
          finish(request.options[selectedIndex]?.value);
        } else if (key === keys.up || key === keys.down) {
          const step = key === keys.up ? -1 : 1;
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
