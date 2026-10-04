import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeDraft } from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatch, type DispatchDependencies } from '../src/commands/dispatch';

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

function writeDraft(stem: string, body: string): void {
  mkdirSync(join(workspace, 'draft'), { recursive: true });
  writeFileSync(
    join(workspace, 'draft', `${stem}.md`),
    serializeDraft({
      sceneStem: stem,
      format: 'novel',
      generatedAt: '2026-10-04T00:00:00.000Z',
      body,
    }),
  );
}

async function runJson(...argv: string[]): Promise<{ ok: boolean; message: string; data: any }> {
  const result = await dispatch([...argv, '--json'], deps());
  return JSON.parse(result.stdout);
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-views-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-views-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

  const init = await dispatch(['init', '--title', '보기 시험', '--genre', '미스터리'], deps());
  expect(init.exitCode).toBe(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('scene list', () => {
  it('reports an empty workspace without failing', async () => {
    const listed = await runJson('scene', 'list');

    expect(listed.ok).toBe(true);
    expect(listed.data.scenes).toEqual([]);
  });

  it('lists scene cards in number order with whether each has a draft', async () => {
    await dispatch(['scene', 'create', '--name', 'opening'], deps());
    await dispatch(['scene', 'create', '--name', 'storm'], deps());
    writeDraft('01-opening', '비가 그친 항구에 첫 배가 들어왔다.');

    const listed = await runJson('scene', 'list');

    expect(listed.data.scenes.map((scene: { stem: string }) => scene.stem)).toEqual([
      '01-opening',
      '02-storm',
    ]);
    expect(listed.data.scenes[0].draft).not.toBe('missing');
    expect(listed.data.scenes[1].draft).toBe('missing');

    const text = await dispatch(['scene', 'list'], deps());
    expect(text.stdout).toContain('02-storm\t\t초안 없음');
  });
});

describe('draft show', () => {
  it('prints the body alone, and the path with --json', async () => {
    await dispatch(['scene', 'create', '--name', 'opening'], deps());
    writeDraft('01-opening', '비가 그친 항구에 첫 배가 들어왔다.\n\n하나는 우산을 접었다.');

    const shown = await runJson('draft', 'show', '01-opening');
    const text = await dispatch(['draft', 'show', '01-opening'], deps());

    expect(shown.ok).toBe(true);
    expect(shown.data.path).toBe(join(workspace, 'draft', '01-opening.md'));
    expect(shown.data.body).toContain('하나는 우산을 접었다.');
    expect(shown.data.characterCount).toBe(shown.data.body.length);
    expect(text.stdout).toBe(`${shown.data.body.trimEnd()}\n`);
  });

  it('fails when the scene has no draft', async () => {
    const result = await dispatch(['draft', 'show', '01-opening'], deps());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('초안이 없습니다: 01-opening');
  });
});

describe('card list and card show', () => {
  beforeEach(async () => {
    await dispatch(['card', 'create', 'character', '--name', '하나', '--id', 'hana'], deps());
    await dispatch(['card', 'create', 'background', '--name', 'Night Market'], deps());
  });

  it('lists both kinds, or the one named', async () => {
    const all = await runJson('card', 'list');
    const characters = await runJson('card', 'list', 'character');
    const unknown = await dispatch(['card', 'list', 'narrator'], deps());

    expect(all.data.cards.map((card: { id: string }) => card.id)).toEqual([
      'hana',
      'night-market',
    ]);
    expect(characters.data.cards).toEqual([
      { category: 'character', id: 'hana', name: '하나', role: 'main', error: null },
    ]);
    expect(unknown.exitCode).toBe(1);
  });

  it('finds a card by id without being told its kind', async () => {
    const character = await runJson('card', 'show', 'hana');
    const background = await runJson('card', 'show', 'night-market');
    const missing = await dispatch(['card', 'show', 'nobody'], deps());

    expect(character.data.category).toBe('character');
    expect(character.data.card.name).toBe('하나');
    expect(background.data.category).toBe('background');
    expect(missing.exitCode).toBe(1);
  });
});

describe('project show', () => {
  it('shows the contract and names what is still empty', async () => {
    const shown = await runJson('project', 'show');

    expect(shown.data.name).toBe('보기 시험');
    expect(shown.data.setting.genre).toBe('미스터리');
    expect(shown.data.missing).toEqual(['audience', 'pov', 'targetWordCount']);
    expect(shown.message).toContain('독자층: —');
  });
});
