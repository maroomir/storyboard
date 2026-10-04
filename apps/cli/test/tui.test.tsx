import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryboardTui } from '../src/tui/app';
import { describeHeader } from '../src/tui/index';
import { splitCommandLine, suggestForInput } from '../src/tui/session';
import { selectVisibleWindow } from '../src/tui/suggestionList';

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-tui-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-tui-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A person types one key at a time; a whole string in one write reaches Ink as a single chunk.
async function typeKeys(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  for (const key of text) {
    stdin.write(key);
    await wait(5);
  }
}

describe('splitCommandLine', () => {
  it('keeps quoted arguments together', () => {
    expect(splitCommandLine('init --title "밤의 항해" --language ko')).toEqual([
      'init',
      '--title',
      '밤의 항해',
      '--language',
      'ko',
    ]);
  });
});

describe('suggestForInput', () => {
  it('proposes verbs by prefix and slash commands by leading slash', () => {
    expect(suggestForInput('draft gen', cwd).map((s) => s.text)).toEqual(['draft generate']);
    expect(suggestForInput('/he', cwd).map((s) => s.text)).toEqual(['/help']);
    expect(suggestForInput('', cwd)).toEqual([]);
  });

  it('completes the word after the verb and keeps what was typed before it', () => {
    expect(suggestForInput('draft check ', cwd).map((s) => s.line)).toEqual([
      'draft check grammar ',
      'draft check continuity ',
      'draft check slop ',
    ]);
    expect(suggestForInput('draft generate --f', cwd)).toEqual([
      expect.objectContaining({ text: '--force', line: 'draft generate --force ' }),
    ]);
  });

  it('falls back to the closest verbs for a misspelled one', () => {
    expect(suggestForInput('scen genrate', cwd).map((s) => s.text)).toContain('draft generate');
  });
});

describe('selectVisibleWindow', () => {
  it('keeps the selection inside an eight-row window', () => {
    expect(selectVisibleWindow(3, 2)).toEqual([0, 3]);
    expect(selectVisibleWindow(20, 0)).toEqual([0, 8]);
    expect(selectVisibleWindow(20, 10)).toEqual([6, 14]);
    expect(selectVisibleWindow(20, 19)).toEqual([12, 20]);
  });
});

describe('describeHeader', () => {
  it('tells the author the folder is not a workspace and no provider is set', () => {
    const header = describeHeader(cwd);

    expect(header.workspaceLabel).toContain('워크스페이스 아님');
    expect(header.providerLabel).toBe('AI 프로바이더 없음');
    expect(header.hint).toContain('setup');
  });
});

describe('StoryboardTui', () => {
  it('renders the header, runs a typed command, and shows its result in the log', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );

    expect(lastFrame()).toContain('Storyboard');
    expect(lastFrame()).toContain('1.2.3');
    await wait(50);

    stdin.write('/doctor');
    await wait(20);
    stdin.write('\r');
    await wait(200);

    expect(lastFrame()).toContain('› /doctor');
    expect(lastFrame()).toContain('storyboard setup');
  });

  it('shows suggestions while typing and completes one with Tab', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    // Ink attaches its input listener in an effect, after the first frame.
    await wait(50);

    stdin.write('config s');
    await wait(20);
    expect(lastFrame()).toContain('config show');
    expect(lastFrame()).toContain('config set');

    stdin.write('\t');
    await wait(20);
    expect(lastFrame()).toContain('❯ config show');
  });

  it('closes the list with Esc, then clears the line with a second Esc', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, 'config s');
    await wait(20);
    expect(lastFrame()).toContain('Tab 확정');

    stdin.write('\u001b');
    await wait(50);
    expect(lastFrame()).not.toContain('Tab 확정');
    expect(lastFrame()).toContain('❯ config s');

    stdin.write('\u001b');
    await wait(50);
    expect(lastFrame()).not.toContain('config s');
  });
});
