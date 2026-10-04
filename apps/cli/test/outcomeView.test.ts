import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatch, type DispatchDependencies } from '../src/commands/dispatch';
import { markOutcome } from '../src/commands/outcomeView';
import type { TerminalFacts } from '../src/terminal/profile';
import { createTheme } from '../src/terminal/theme';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

const atTerminal: TerminalFacts = {
  stdout: { isTty: true, columns: 80 },
  stderr: { isTty: true, columns: 80 },
  // A person at a terminal who turned color off: the marks stay, the escape codes go.
  env: { NO_COLOR: '1' },
};

const tty = { isTty: true, columns: 80, theme: createTheme(false) };

let home: string;
let workspace: string;

function deps(terminal?: TerminalFacts): DispatchDependencies {
  return {
    version: '0.0.0',
    cwd: workspace,
    isInteractive: false,
    createLogger: () => silentLogger,
    ...(terminal === undefined ? {} : { terminal }),
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-outcome-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-outcome-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('markOutcome', () => {
  it('checks an action, crosses a failure, and leaves printed data alone', () => {
    expect(markOutcome('씬 카드를 만들었습니다\n경로', { ok: true, isAction: true }, tty)).toBe(
      '✔ 씬 카드를 만들었습니다\n경로',
    );
    expect(markOutcome('초안이 없습니다', { ok: false, isAction: false }, tty)).toBe(
      '✖ 초안이 없습니다',
    );
    expect(markOutcome('본문 첫 줄', { ok: true, isAction: false }, tty)).toBe('본문 첫 줄');
  });

  it('adds nothing for a pipe', () => {
    const pipe = { ...tty, isTty: false };
    expect(markOutcome('실패', { ok: false, isAction: false }, pipe)).toBe('실패');
  });
});

describe('result after a run', () => {
  it('marks a finished action and names the next command at a terminal', async () => {
    const result = await dispatch(['init', '--title', '다음 단계'], deps(atTerminal));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith('✔ ')).toBe(true);
    expect(result.stderr).toMatch(/^다음 → {2}storyboard \S/);
  });

  it('keeps pipes and --json exactly as before', async () => {
    const piped = await dispatch(['init', '--title', '파이프'], deps());
    const json = await dispatch(['scene', 'list', '--json'], deps(atTerminal));

    expect(piped.stdout.startsWith('✔')).toBe(false);
    expect(piped.stderr).toBe('');
    expect(json.stderr).toBe('');
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });

  it('suggests nothing after a command that only reads', async () => {
    await dispatch(['init', '--title', '읽기'], deps());
    const result = await dispatch(['scene', 'list'], deps(atTerminal));

    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('✔')).toBe(false);
  });

  it('crosses out a failure on stderr at a terminal', async () => {
    const result = await dispatch(['draft', 'show', 'none'], deps(atTerminal));

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('✖ ');
  });
});
