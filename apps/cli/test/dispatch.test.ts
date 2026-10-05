import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatch, type DispatchDependencies } from '../src/commands/dispatch';

let home: string;
let cwd: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function deps(overrides: Partial<DispatchDependencies> = {}): DispatchDependencies {
  return {
    version: '1.2.3',
    cwd,
    isInteractive: false,
    createLogger: () => silentLogger,
    ...overrides,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-cli-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('dispatch', () => {
  it('prints grouped usage on stdout with exit 0 for a bare invocation', async () => {
    const result = await dispatch([], deps());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('처음이라면');
    expect(result.stderr).toBe('');
    expect(result.launchTui).toBeUndefined();
  });

  it('launches the TUI for a bare invocation at a terminal, and for the tui verb anywhere', async () => {
    expect((await dispatch([], deps({ isInteractive: true }))).launchTui).toBe(true);
    expect((await dispatch(['tui'], deps())).launchTui).toBe(true);
    expect((await dispatch(['--help'], deps({ isInteractive: true }))).launchTui).toBeUndefined();
  });

  it('answers -v and per-verb -h', async () => {
    expect((await dispatch(['-v'], deps())).stdout).toBe('1.2.3\n');
    const help = await dispatch(['draft', 'generate', '-h'], deps());
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('storyboard draft generate <stem> | --all');
  });

  it('opens help at the group list, one group, or every command', async () => {
    const short = await dispatch(['--help'], deps());
    const all = await dispatch(['help', '--all'], deps());
    const group = await dispatch(['help', 'draft'], deps());

    expect(short.stdout).toContain('명령 묶음');
    expect(short.stdout).not.toContain('draft condense');
    expect(all.stdout).toContain('draft condense');
    expect(group.exitCode).toBe(0);
    expect(group.stdout).toContain('draft condense');
    expect((await dispatch(['help', 'nothing'], deps())).exitCode).toBe(1);
  });

  it('names the flag that was meant when one is misspelled', async () => {
    const result = await dispatch(['init', '--titel', '작품'], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('알 수 없는 옵션: --titel');
    expect(result.stderr).toContain('혹시 →  --title');
  });

  it('accepts --no-color anywhere and keeps a run without real streams free of color codes', async () => {
    const result = await dispatch(['--no-color', '-v'], deps());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1.2.3\n');
    expect((await dispatch(['--help'], deps())).stdout).not.toContain('\u001b[');
  });

  it('keeps every failure inside the JSON envelope when --json is set', async () => {
    const unknown = await dispatch(['scene', 'generat', '--json'], deps());
    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false });
    expect(unknown.stderr).toBe('');

    const noWorkspace = await dispatch(['draft', 'generate', '01', '--json'], deps());
    expect(JSON.parse(noWorkspace.stdout).message).toContain('storyboard init --title');
  });

  it('names the fix on stderr for a missing workspace without --json', async () => {
    const result = await dispatch(['draft', 'generate', '01'], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('storyboard init --title');
    expect(result.stdout).toBe('');
  });

  it('runs a config-writing verb outside a workspace only when --global says where', async () => {
    const ambiguous = await dispatch(['setup', '--provider', 'mock'], deps());

    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain('--global');

    const result = await dispatch(['setup', '--provider', 'mock', '--global'], deps());

    expect(result.exitCode).toBe(0);
    expect(result.outcome?.ok).toBe(true);
    expect(result.stdout).toContain('mock');
    expect(result.outcome?.data).toMatchObject({ file: join(home, 'config.json') });
  });

  it('writes settings to the workspace it is run in, and to the home file with --global', async () => {
    mkdirSync(join(cwd, '.storyboard'), { recursive: true });
    writeFileSync(join(cwd, '.storyboard', 'project.json'), '{"id":"w","name":"작품"}');

    const local = await dispatch(['config', 'set', 'generation.beats.charsPerBeat', '300'], deps());

    expect(local.exitCode).toBe(0);
    expect(local.outcome?.data).toMatchObject({
      file: join(cwd, '.storyboard', 'config.json'),
      origin: 'workspace',
    });

    const global = await dispatch(
      ['config', 'set', 'generation.beats.charsPerBeat', '900', '--global'],
      deps(),
    );

    expect(global.outcome?.data).toMatchObject({ file: join(home, 'config.json') });
    expect(readFileSync(join(cwd, '.storyboard', 'config.json'), 'utf8')).toContain('300');
  });

  it('names the allowed range when a value is outside it', async () => {
    const result = await dispatch(
      ['config', 'set', 'revise.loop.maxIterations', '9', '--global'],
      deps(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('1 이상 5 이하여야 합니다: 9');
  });
});
