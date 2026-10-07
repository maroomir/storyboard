import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function deps(): DispatchDependencies {
  return { version: '1.2.3', cwd, isInteractive: false, createLogger: () => silentLogger };
}

function writeFile(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), text);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-params-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-params-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(async () => {
  // Leave the process-wide resource stores as the next test expects them.
  await dispatch(['params', 'show', '--json'], {
    ...deps(),
    cwd: mkdtempSync(join(tmpdir(), 'x-')),
  });
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

interface ParameterRow {
  readonly kind: string;
  readonly id: string;
  readonly value: unknown;
  readonly defaultValue: unknown;
  readonly origin: string;
}

async function parameters(): Promise<{
  readonly parameters: ParameterRow[];
  readonly resources: { applied: { kind: string; file: string }[] };
}> {
  const result = await dispatch(['params', 'show', '--json'], deps());

  expect(result.exitCode).toBe(0);

  return (JSON.parse(result.stdout) as { data: never }).data;
}

describe('params show', () => {
  it('lists settings, generation knobs and prompt tuning with their origin', async () => {
    writeFile(home, 'config.json', '{ "revise": { "loop": { "maxIterations": 4 } } }');
    writeFile(join(cwd, '.storyboard'), 'project.json', '{"id":"w","name":"작품"}');
    writeFile(
      join(cwd, '.storyboard'),
      'config.json',
      '{ "revise": { "loop": { "afterGenerate": false } } }',
    );

    const report = await parameters();
    const byId = new Map(report.parameters.map((row) => [row.id, row]));

    expect(byId.get('revise.loop.maxIterations')).toMatchObject({
      kind: 'setting',
      value: 4,
      origin: 'user',
    });
    expect(byId.get('revise.loop.afterGenerate')).toMatchObject({
      kind: 'setting',
      value: false,
      defaultValue: true,
      origin: 'workspace',
    });
    expect(byId.get('generation.section.retryLimit')).toMatchObject({
      kind: 'generation',
      origin: 'default',
    });
    expect(byId.get('prompt.grammarCheck.temperature')).toMatchObject({
      kind: 'prompt',
      value: 0.1,
      origin: 'default',
    });
    expect(byId.get('prompt.noteExtraction.reasoningEffort')).toMatchObject({
      kind: 'prompt',
      value: 'low',
      origin: 'default',
    });
    expect(byId.has('prompt.grammarCheck.reasoningEffort')).toBe(false);
  });

  it('shows a prompt file as the origin of the tuning it carries', async () => {
    writeFile(
      join(cwd, '.storyboard', 'prompts'),
      'grammarCheck.md',
      '---\ntemperature: 0.7\nmaxTokens: 2000\n---\n## system\nx\n\n## user\n{{body}}\n',
    );

    const report = await parameters();
    const byId = new Map(report.parameters.map((row) => [row.id, row]));

    expect(byId.get('prompt.grammarCheck.temperature')).toMatchObject({
      value: 0.7,
      defaultValue: 0.1,
      origin: 'workspace',
    });
    expect(byId.get('prompt.grammarCheck.maxTokens')).toMatchObject({ origin: 'default' });
    expect(report.resources.applied.map((entry) => entry.kind)).toEqual(['prompt']);
  });

  it('prints the sections and the resource files as text', async () => {
    writeFile(home, 'craftContract.json', '{ "motifRepeatLimit": 5 }');

    const result = await dispatch(['params', 'show'], deps());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[설정 (config.json)]');
    expect(result.stdout).toContain('[생성 손잡이');
    expect(result.stdout).toContain('prompt.grammarCheck.temperature');
    expect(result.stdout).toContain(`craftContract       ${join(home, 'craftContract.json')}`);
  });
});
