import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandDispatcher, type DispatchDependencies, type DispatchResult } from '@/commands/commandDispatcher';

const silentLogger = { info: (): void => undefined, warn: (): void => undefined, error: (): void => undefined, show: (): void => undefined };

let home: string;
let workspace: string;

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

async function dispatch(argv: readonly string[]): Promise<DispatchResult> {
  return new CommandDispatcher(deps()).dispatch([...argv]);
}

async function step(...extra: string[]): Promise<{ readonly state: string; readonly axis?: string; readonly candidateCount?: number }> {
  const result: DispatchResult = await dispatch(['card', 'interview', 'hana-pov', '--step', '--json', ...extra]);
  expect(result.exitCode, result.stdout).toBe(0);
  const data = JSON.parse(result.stdout).data as {
    readonly state: string;
    readonly question?: { readonly axis: string };
    readonly summary?: { readonly candidateCount: number };
  };
  return {
    state: data.state,
    ...(data.question === undefined ? {} : { axis: data.question.axis }),
    ...(data.summary === undefined ? {} : { candidateCount: data.summary.candidateCount }),
  };
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-narrator-interview-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-narrator-interview-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await dispatch([
    'init', '--title', '두 시점', '--composition', 'alternating-pov', '--pov-characters', 'hana,jun',
    '--chapters', '1', '--scenes-per-chapter', '1', '--yes',
  ]);
  expect((await dispatch(['novel', 'generate', '--json'])).exitCode).toBe(0);
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('narrator interview (A5)', () => {
  it('asks how the narrator tells each beat of its scenes and distils the answers into a voice proposal', async () => {
    expect(await step()).toEqual({ state: 'question', axis: '서술 방식' });
    expect((await step('--answer', '1')).state).toBe('question');
    expect((await step('--write', '감정은 말하지 않고 손끝만 비춘다')).state).toBe('question');

    expect(await step('--finish')).toEqual({ state: 'finished', candidateCount: 1 });
    expect((await dispatch(['card', 'apply', 'hana-pov'])).exitCode).toBe(0);
    expect(readFileSync(join(workspace, 'narrator', 'hana-pov.card', 'statements.yaml'), 'utf8')).toContain(
      'facet: voice',
    );
  }, 120_000);
});
