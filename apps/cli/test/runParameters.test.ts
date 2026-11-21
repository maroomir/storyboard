import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRunParametersFile, type RunParametersRead } from '@/adapters/runParametersFile';
import { CommandDispatcher, type DispatchDependencies, type DispatchResult } from '@/commands/commandDispatcher';
import { createCliContainer, type CliContainer } from '@/container';

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

function writeParams(name: string, content: unknown): string {
  const file: string = join(cwd, name);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

interface ParameterRow {
  readonly id: string;
  readonly value: unknown;
  readonly defaultValue: unknown;
  readonly origin: string;
  readonly valueKind: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

async function showParameters(extraArgs: readonly string[]): Promise<ReadonlyMap<string, ParameterRow>> {
  const result: DispatchResult = await new CommandDispatcher(deps()).dispatch(['params', 'show', '--json', ...extraArgs]);
  expect(result.exitCode).toBe(0);

  const rows: readonly ParameterRow[] = (JSON.parse(result.stdout) as { data: { parameters: ParameterRow[] } }).data.parameters;
  return new Map(rows.map((row) => [row.id, row]));
}

async function refusalOf(content: unknown): Promise<string> {
  const result: DispatchResult = await new CommandDispatcher(deps()).dispatch([
    'params',
    'show',
    '--params',
    writeParams('refused.json', content),
  ]);
  expect(result.exitCode).toBe(1);
  return result.stderr;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-run-params-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-run-params-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(async () => {
  await showParameters([]);
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('--params', () => {
  const point: Readonly<Record<string, number>> = {
    'revise.loop.maxIterations': 2,
    'generation.section.outputLimit': 1000,
    'generation.skeleton.lengthRatio': 0.8,
    'prompt.sceneSkeleton.temperature': 0.35,
    'prompt.sceneSkeleton.maxTokens': 1234,
  };

  it('lays a file over every other source for this run and says so', async () => {
    const shown: ReadonlyMap<string, ParameterRow> = await showParameters(['--params', writeParams('point.json', point)]);

    for (const [id, value] of Object.entries(point)) {
      expect(shown.get(id), id).toMatchObject({ value, origin: 'run' });
    }
    expect(shown.get('generation.section.retryLimit')?.origin).toBe('default');
  });

  it('reaches the generation knobs the pipeline reads', () => {
    const read: RunParametersRead = readRunParametersFile(writeParams('point.json', point));
    if (!read.ok) {
      throw new Error(read.message);
    }

    const container: CliContainer = createCliContainer({
      workspacePath: cwd,
      logger: silentLogger,
      canPrompt: false,
      version: '1.2.3',
      runParameters: read.parameters,
    });

    expect(container.configBridge.getSceneGenerationTuning()).toMatchObject({ 'generation.skeleton.lengthRatio': 0.8 });
    expect(container.configBridge.getSectionOutputLimit()).toBe(1000);
    expect(container.configBridge.getReviseMaxIterations()).toBe(2);
  });

  it('writes nothing: the next run without the file is back on its defaults', async () => {
    writeFileSync(join(cwd, 'unrelated.txt'), '');
    mkdirSync(join(cwd, '.storyboard'), { recursive: true });
    writeFileSync(join(cwd, '.storyboard', 'project.json'), '{"id":"w","name":"작품"}');

    const during: ReadonlyMap<string, ParameterRow> = await showParameters(['--params', writeParams('point.json', point)]);
    const after: ReadonlyMap<string, ParameterRow> = await showParameters([]);

    for (const id of Object.keys(point)) {
      expect(after.get(id)?.origin, id).not.toBe('run');
      expect(after.get(id)?.value, id).toBe(during.get(id)?.defaultValue);
    }
  });

  it('refuses a file it cannot apply in full, before anything runs', async () => {
    expect(await refusalOf({ 'generation.skeleton.lengthRato': 0.8 })).toContain('알 수 없는 키');
    expect(await refusalOf({ 'generation.skeleton.lengthRatio': 7 })).toContain('0.05 이상 1 이하');
    expect(await refusalOf({ 'generation.skeleton.lengthRatio': '0.8' })).toContain('숫자여야 합니다');
    expect(await refusalOf({ 'prompt.noSuchPrompt.temperature': 0.5 })).toContain('알 수 없는 프롬프트 값');
    expect(await refusalOf({ 'prompt.sceneSkeleton.temperature': 3 })).toContain('0 이상 2 이하');
    expect(await refusalOf({ 'prompt.sceneSkeleton.maxTokens': 0.5 })).toContain('1 이상의 정수');
    expect(await refusalOf({ 'revise.loop.maxIterations': 99 })).toContain('설정 값이 올바르지 않습니다');
    expect(await refusalOf('[1, 2]')).toContain('최상위는 객체');
    expect(await refusalOf('{ not json')).toContain('올바른 JSON이 아닙니다');
  });

  it('is taken by the verbs a measured run calls and refused when the file is missing', async () => {
    mkdirSync(join(cwd, '.storyboard'), { recursive: true });
    writeFileSync(join(cwd, '.storyboard', 'project.json'), '{"id":"w","name":"작품"}');

    for (const verb of [['draft', 'generate', '001'], ['draft', 'revise', '001'], ['state', 'generate']]) {
      const result: DispatchResult = await new CommandDispatcher(deps()).dispatch([...verb, '--params', 'missing.json']);
      expect(result.exitCode, verb.join(' ')).toBe(1);
      expect(result.stderr, verb.join(' ')).toContain('--params 파일을 읽지 못했습니다');
    }
  });
});

describe('params show --json', () => {
  it('says what kind of value each parameter is and where it must stay', async () => {
    const shown: ReadonlyMap<string, ParameterRow> = await showParameters([]);

    expect(shown.get('generation.skeleton.lengthRatio')).toMatchObject({ valueKind: 'ratio', minimum: 0.05, maximum: 1 });
    expect(shown.get('revise.loop.maxIterations')).toMatchObject({ valueKind: 'integer', minimum: 1, maximum: 5 });
    expect(shown.get('prompt.sceneSkeleton.temperature')).toMatchObject({ valueKind: 'temperature', minimum: 0, maximum: 2 });
    expect(shown.get('prompt.sceneSkeleton.maxTokens')).toMatchObject({ valueKind: 'tokens', minimum: 1 });
  });
});
