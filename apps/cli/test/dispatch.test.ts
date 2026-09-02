import { mkdtempSync, rmSync } from 'node:fs';
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
    const help = await dispatch(['scene', 'generate', '-h'], deps());
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain('storyboard scene generate <stem> | --all');
  });

  it('keeps every failure inside the JSON envelope when --json is set', async () => {
    const unknown = await dispatch(['scene', 'generat', '--json'], deps());
    expect(unknown.exitCode).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false });
    expect(unknown.stderr).toBe('');

    const noWorkspace = await dispatch(['scene', 'generate', '01', '--json'], deps());
    expect(JSON.parse(noWorkspace.stdout).message).toContain('storyboard init --title');
  });

  it('names the fix on stderr for a missing workspace without --json', async () => {
    const result = await dispatch(['scene', 'generate', '01'], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('storyboard init --title');
    expect(result.stdout).toBe('');
  });

  it('runs a machine-wide verb without a workspace and returns its outcome', async () => {
    const result = await dispatch(['setup', '--provider', 'mock'], deps());

    expect(result.exitCode).toBe(0);
    expect(result.outcome?.ok).toBe(true);
    expect(result.stdout).toContain('mock');
  });
});
