import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeDraft } from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDraftRevisions } from './fixtures/sceneBundles';

import { commandCatalog } from '@/commands/index';
import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';
import { nextStepCommands } from '@/commands/workspaceNextStep';

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
  const result = await new CommandDispatcher(deps()).dispatch([...argv, '--json']);
  return JSON.parse(result.stdout);
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-views-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-views-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

  const init = await new CommandDispatcher(deps()).dispatch(['init', '--title', '보기 시험', '--genre', '미스터리']);
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
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'storm']);
    writeDraft('001-opening', '비가 그친 항구에 첫 배가 들어왔다.');

    const listed = await runJson('scene', 'list');

    expect(listed.data.scenes.map((scene: { stem: string }) => scene.stem)).toEqual([
      '001-opening',
      '002-storm',
    ]);
    expect(listed.data.scenes[0].draft).not.toBe('missing');
    expect(listed.data.scenes[1]).toMatchObject({ slug: 'storm', number: 2, thread: 'main', draft: 'missing' });
    expect(listed.data.scenes[1].uuid).toMatch(/^[0-9a-f-]{36}$/);

    const text = await new CommandDispatcher(deps()).dispatch(['scene', 'list']);
    expect(text.stdout).toContain('번호\t제목\t상태');
    expect(text.stdout).toContain('002\tstorm\t초안 없음');
    expect(text.stdout).not.toContain('main');
  });

  it('shows the thread column once a work has two threads', async () => {
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    await new CommandDispatcher(deps()).dispatch(['project', 'set', '--composition', 'omnibus', '--episodes', '2']);
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'storm']);
    const structure: string = join(workspace, '.storyboard', 'structure.yaml');
    writeFileSync(structure, readFileSync(structure, 'utf8').replace(/thread: main\n(?![\s\S]*thread: main)/, 'thread: ep1\n'));

    const text = await new CommandDispatcher(deps()).dispatch(['scene', 'list']);

    expect(text.stdout).toContain('번호\t줄기\t제목\t상태');
    expect(text.stdout).toContain('002\tep1\tstorm\t초안 없음');
  });

  it('moves, inserts and removes scenes, renumbering the rest', async () => {
    for (const name of ['opening', 'storm', 'harbor']) {
      await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', name]);
    }
    writeDraft('003-harbor', '항구의 불빛이 꺼졌다.');

    const moved = await new CommandDispatcher(deps()).dispatch(['scene', 'move', 'harbor', '--after', '1']);
    expect(moved.exitCode, moved.stdout).toBe(0);
    expect(moved.stdout).toContain('003-harbor → 002-harbor');

    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'rain', '--after', 'opening']);
    const removed = await new CommandDispatcher(deps()).dispatch(['scene', 'remove', 'storm']);
    expect(removed.exitCode, removed.stdout).toBe(0);

    const listed = await runJson('scene', 'list');
    expect(listed.data.scenes.map((scene: { stem: string }) => scene.stem)).toEqual([
      '001-opening',
      '002-rain',
      '003-harbor',
    ]);
    expect(readFileSync(join(workspace, 'draft', '003-harbor.md'), 'utf8')).toContain('sceneStem: 003-harbor');
  });
});

describe('draft show', () => {
  it('prints the body alone, and the path with --json', async () => {
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    writeDraft('001-opening', '비가 그친 항구에 첫 배가 들어왔다.\n\n하나는 우산을 접었다.');

    const shown = await runJson('draft', 'show', '001-opening');
    const text = await new CommandDispatcher(deps()).dispatch(['draft', 'show', '001-opening']);

    expect(shown.ok).toBe(true);
    expect(shown.data.path).toBe(join(workspace, 'draft', '001-opening.md'));
    expect(shown.data.body).toContain('하나는 우산을 접었다.');
    expect(shown.data.characterCount).toBe(shown.data.body.length);
    expect(text.stdout).toBe(`${shown.data.body.trimEnd()}\n`);
  });

  it('fails when the scene has no draft', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['draft', 'show', '001-opening']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('초안이 없습니다: 001-opening');
  });
});

describe('card list and card show', () => {
  beforeEach(async () => {
    await new CommandDispatcher(deps()).dispatch(['card', 'create', 'character', '등대지기의 손녀', '--name', '하나', '--id', 'hana']);
    await new CommandDispatcher(deps()).dispatch(['card', 'create', 'background', '자정에 닫는 야시장', '--name', 'Night Market']);
  });

  it('lists both kinds, or the one named', async () => {
    const all = await runJson('card', 'list');
    const characters = await runJson('card', 'list', 'character');
    const unknown = await new CommandDispatcher(deps()).dispatch(['card', 'list', 'monster']);

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
    const missing = await new CommandDispatcher(deps()).dispatch(['card', 'show', 'nobody']);

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

describe('status', () => {
  it('walks the next step from an empty contract to a reviewed manuscript', async () => {
    const empty = await runJson('status');
    expect(empty.data.project.missingContract).toEqual(['audience', 'pov', 'targetWordCount']);
    expect(empty.data.next).toMatchObject({ step: 'fill-contract', command: 'project set' });

    await new CommandDispatcher(deps()).dispatch(['project', 'set', '--audience', '성인', '--pov', 'third-limited', '--target-words', '90000']);
    expect((await runJson('status')).data.next.command).toBe('outline generate');

    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'storm']);
    await new CommandDispatcher(deps()).dispatch(['card', 'create', 'character', '등대지기의 손녀', '--name', '하나', '--id', 'hana']);
    writeDraft('001-opening', '비가 그친 항구에 첫 배가 들어왔다.');

    const drafting = await runJson('status');
    expect(drafting.data.scenes).toEqual({ total: 2 });
    expect(drafting.data.drafts).toMatchObject({ missing: 1, withWarnings: 0 });
    expect(drafting.data.cards).toEqual({ characters: 1, backgrounds: 0, narrators: 0 });
    expect(drafting.data.next.command).toBe('draft generate --all');

    writeDraft('002-storm', '폭풍이 방파제를 넘었다.');
    expect((await runJson('status')).data.next.command).toBe('manuscript assemble');

    mkdirSync(join(workspace, 'manuscript'), { recursive: true });
    writeFileSync(join(workspace, 'manuscript', 'manuscript.md'), '# 보기 시험\n');
    expect((await runJson('status')).data.next.command).toBe('manuscript review');

    writeFileSync(join(workspace, 'manuscript', 'REVIEW.md'), '# 검사\n');
    const done = await runJson('status');
    expect(done.data.next).toMatchObject({ step: 'none', command: null });
    expect(done.data.manuscript).toEqual({ isAssembled: true, isStale: false, isReviewed: true });
  });

  it('prints the overview with the next command on the last line', async () => {
    const result = await new CommandDispatcher(deps()).dispatch(['status']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('계약      독자층·시점·목표 분량 비어 있음');
    expect(result.stdout.trimEnd().split('\n').at(-1)).toContain('storyboard project set');
  });

  it('only recommends commands the catalog has', () => {
    const verbs = commandCatalog.map((spec) => spec.verb);

    for (const command of Object.values(nextStepCommands)) {
      if (command !== undefined) {
        expect(verbs.some((verb) => `${command} `.startsWith(`${verb} `))).toBe(true);
      }
    }
  });
});

describe('manuscript export --out', () => {
  it('writes plain text for a .txt target and markdown otherwise', async () => {
    mkdirSync(join(workspace, 'manuscript'), { recursive: true });
    writeFileSync(join(workspace, 'manuscript', 'manuscript.md'), '# 보기 시험\n\n**밤**이 왔다.\n');

    const text = await new CommandDispatcher(deps()).dispatch(['manuscript', 'export', '--out', join(workspace, 'out.txt')]);
    const markdown = await new CommandDispatcher(deps()).dispatch(['manuscript', 'export', '--out', join(workspace, 'out.md')]);

    expect(text.exitCode).toBe(0);
    expect(markdown.exitCode).toBe(0);
    expect(readFileSync(join(workspace, 'out.txt'), 'utf8')).toBe('보기 시험\n\n밤이 왔다.\n');
    expect(readFileSync(join(workspace, 'out.md'), 'utf8')).toContain('**밤**');
  });
});

describe('draft check', () => {
  it('runs slop locally and skips continuity when no card fact applies', async () => {
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    writeDraft('001-opening', '비가 그친 항구에 첫 배가 들어왔다.');

    const slop = await runJson('draft', 'check', 'slop', '001-opening');
    const continuity = await runJson('draft', 'check', 'continuity', '001-opening');

    expect(Array.isArray(slop.data)).toBe(true);
    expect(continuity).toMatchObject({ ok: true, message: '대조할 카드의 사실이 없습니다.' });
  });
});

describe('draft expand', () => {
  it('keeps the version it started from as a revision', async () => {
    await new CommandDispatcher(deps()).dispatch(['scene', 'create', '--name', 'opening']);
    writeDraft('001-opening', '비가 그친 항구에 첫 배가 들어왔다.\n\n하나는 우산을 접었다.');

    const expanded = await new CommandDispatcher(deps()).dispatch(['draft', 'expand', '001-opening']);

    expect(expanded.exitCode, expanded.stdout).toBe(0);
    expect(await listDraftRevisions(workspace, '001-opening')).toHaveLength(1);
  });
});
