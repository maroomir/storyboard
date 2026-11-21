import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

let home: string;
let workspace: string;

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

async function run(...argv: string[]): Promise<void> {
  expect((await new CommandDispatcher(deps()).dispatch(argv)).exitCode).toBe(0);
}

async function readJson(...argv: string[]): Promise<unknown> {
  const result = await new CommandDispatcher(deps()).dispatch([...argv, '--json']);
  expect(result.exitCode).toBe(0);
  return (JSON.parse(result.stdout) as { data: unknown }).data;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-read-contract-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-read-contract-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

  await run('init', '--title', '계약 시험', '--genre', '미스터리');
  await run('card', 'create', 'character', '등대지기의 손녀', '--name', '하나', '--id', 'hana');
  await run('card', 'set', 'hana', 'fact', '왼손잡이다');
  await run('card', 'create', 'background', '바닷가 등대', '--name', '등대', '--id', 'lighthouse');
  await writeSceneBundleFromYaml(
    workspace,
    [
      'type: scene',
      'id: 001-opening',
      'characters:',
      '  - hana',
      'beats:',
      '  - 하나가 항구에 선다',
      '  - text: 하나가 등대에 오른다',
      '    cast: [hana]',
      '    place: lighthouse',
      '',
    ].join('\n'),
  );
  await run('scene', 'set', '001-opening', '--target-words', '3000');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('read outputs an outside tool relies on', () => {
  it('scene list --json gives each scene its stem and number in order', async () => {
    expect(await readJson('scene', 'list')).toMatchObject({
      scenes: [{ stem: '001-opening', number: 1 }],
    });
  });

  it('scene show --json gives the target length and the numbered beats with their coordinates', async () => {
    expect(await readJson('scene', 'show', '001-opening')).toMatchObject({
      stem: '001-opening',
      targetLength: expect.any(Number),
      beats: [
        { number: 1, text: '하나가 항구에 선다' },
        { number: 2, text: '하나가 등대에 오른다', cast: ['hana'], place: '등대' },
      ],
    });
  });

  it('card show --json gives the card name and its statements by facet', async () => {
    expect(await readJson('card', 'show', 'hana')).toMatchObject({
      id: 'hana',
      card: { name: '하나' },
      statements: [expect.objectContaining({ facet: 'fact', value: '왼손잡이다' })],
    });
  });

  it('status --json gives the scene count, the draft counts and the next step', async () => {
    expect(await readJson('status')).toMatchObject({
      scenes: { total: 1 },
      drafts: { ready: 0, stale: 0, missing: 1 },
      nextStep: expect.any(String),
    });
  });
});
