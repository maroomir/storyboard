import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliContainer } from '../src/container';
import { runConfigSet, runConfigShow, runDoctor, runSetup } from '../src/commands/setup';
import type { ParsedArguments } from '../src/cliArguments';

let home: string;
let workspace: string;

function args(
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
): ParsedArguments {
  return { path: [], flags, positionals };
}

function container(): ReturnType<typeof createCliContainer> {
  return createCliContainer({ workspacePath: workspace, showProgress: false, version: '0.0.0' });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('storyboard setup', () => {
  it('writes the provider given on the command line into the shared config', async () => {
    const outcome = await runSetup({ container: container(), args: args({ provider: 'codex' }) });

    expect(outcome.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      defaultProvider: 'codex',
    });
    expect(outcome.message).toContain(join(home, 'config.json'));
  });

  it('refuses to guess when there is no terminal and no --provider', async () => {
    const outcome = await runSetup({ container: container(), args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('--provider');
  });
});

describe('storyboard doctor', () => {
  it('fails with the setup hint when no provider is configured', async () => {
    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('storyboard setup');
    expect(outcome.message).toContain('storyboard init --title');
  });

  it('passes for a configured mock provider and reports the workspace state', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));

    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('mock');
    expect(outcome.message).toContain('워크스페이스가 아닙니다');
    expect((outcome.data as { checks: unknown[] }).checks.length).toBeGreaterThan(3);
  });
});

describe('storyboard config', () => {
  it('sets a catalog key with type validation and shows it with its origin', async () => {
    const bad = await runConfigSet({
      container: container(),
      args: args({}, ['draft.reviseMaxIterations', 'nine']),
    });
    expect(bad.ok).toBe(false);

    const unknown = await runConfigSet({
      container: container(),
      args: args({}, ['draft.nope', '1']),
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain('쓸 수 있는 키');

    const good = await runConfigSet({
      container: container(),
      args: args({}, ['draft.reviseMaxIterations', '3']),
    });
    expect(good.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      draft: { reviseMaxIterations: 3 },
    });

    const shown = await runConfigShow({ container: container(), args: args() });
    expect(shown.message).toMatch(/draft\.reviseMaxIterations\s+3\s+공통/);
    expect(shown.message).toMatch(/defaultProvider\s+\(없음\)\s+기본값/);
  });

  it('validates provider fields against the catalog', async () => {
    const badModel = await runConfigSet({
      container: container(),
      args: args({}, ['providers.openai.model', 'gpt-99']),
    });
    expect(badModel.ok).toBe(false);

    const cliModel = await runConfigSet({
      container: container(),
      args: args({}, ['providers.codex.model', 'gpt-9-preview']),
    });
    expect(cliModel.ok).toBe(true);

    const provider = await runConfigSet({
      container: container(),
      args: args({}, ['defaultProvider', 'claude-code']),
    });
    expect(provider.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      providers: { codex: { model: 'gpt-9-preview' } },
      defaultProvider: 'claude-code',
    });
  });
});
