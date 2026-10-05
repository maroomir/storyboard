import { EventEmitter } from 'node:events';

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { LiveArea } from '../src/adapters/liveArea';
import { describeChoiceLines, TerminalPrompter } from '../src/adapters/prompter';
import { measureWidth } from '../src/terminal/width';
import { createTheme } from '../src/terminal/theme';
import { ChoiceDialog } from '../src/tui/choiceDialog';

const stream = { isTty: true, columns: 80, theme: createTheme(false) };
const request = {
  title: '초안 14개 생성',
  details: ['모델  mock'],
  options: [
    { label: '진행', value: 'go' },
    { label: '취소', value: 'stop' },
  ],
};

class FakeKeys extends EventEmitter {
  public isRaw = false;
  public setRawMode(mode: boolean): void {
    this.isRaw = mode;
  }
  public resume(): void {}
  public pause(): void {}
}

function prompterWith(keys: FakeKeys): TerminalPrompter {
  return new TerminalPrompter(keys, new LiveArea({ write: () => undefined }, () => 80), stream);
}

describe('terminal prompter', () => {
  it('moves with the arrows and answers with Enter, restoring the terminal mode', async () => {
    const keys = new FakeKeys();
    const answer = prompterWith(keys).choose(request);

    expect(keys.isRaw).toBe(true);
    keys.emit('data', '\u001b[B');
    keys.emit('data', '\r');

    expect(await answer).toBe('stop');
    expect(keys.isRaw).toBe(false);
  });

  it('answers a digit at once and backs out on Esc or Ctrl+C', async () => {
    const keys = new FakeKeys();

    const byDigit = prompterWith(keys).choose(request);
    keys.emit('data', '1');
    expect(await byDigit).toBe('go');

    const byEscape = prompterWith(keys).choose(request);
    keys.emit('data', '\u001b');
    expect(await byEscape).toBeUndefined();

    const byInterrupt = prompterWith(keys).choose(request);
    keys.emit('data', '\u0003');
    expect(await byInterrupt).toBeUndefined();
  });

  it('draws the details and marks the selected option', () => {
    const lines = describeChoiceLines(request, 1, stream).join('\n');

    expect(lines).toContain('초안 14개 생성');
    expect(lines).toContain('❯ 2. 취소');
    expect(lines).toContain('  1. 진행');
  });

  it('keeps the options aligned and the key hint whole in a narrow terminal', () => {
    const lines = describeChoiceLines(request, 0, { ...stream, columns: 40 });

    expect(lines).toContain('  2. 취소');
    expect(lines.every((line) => measureWidth(line) < 40)).toBe(true);
    expect(lines.join('').replace(/\s+/g, '')).toContain('Esc취소');
  });
});

describe('choice dialog', () => {
  it('answers with the chosen index in the interactive screen', async () => {
    const answers: (number | undefined)[] = [];
    const { lastFrame, stdin } = render(
      <ChoiceDialog request={request} onAnswer={(index) => answers.push(index)} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('❯ 1. 진행');
    stdin.write('2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(answers).toEqual([1]);
  });
});
