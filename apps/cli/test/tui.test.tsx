import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryboardTui } from '../src/tui/app';
import { describeHeader } from '../src/tui/index';
import { splitCommandLine, suggestForInput } from '../src/tui/session';

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
    expect(suggestForInput('draft gen').map((s) => s.text)).toEqual(['draft generate']);
    expect(suggestForInput('/he').map((s) => s.text)).toEqual(['/help']);
    expect(suggestForInput('')).toEqual([]);
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
});
