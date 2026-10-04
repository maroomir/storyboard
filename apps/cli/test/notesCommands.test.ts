import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNoteAbsorbPlan, parseScene, coerceNoteExtraction } from '@storyboard/story-model';
import { type PlanNoteAbsorbRequest } from '@storyboard/story-engine';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

const vault = join(__dirname, 'fixtures', 'notes', 'obsidianVault', '달의 문');

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function args(
  path: string[],
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
): ParsedArguments {
  return { path, flags, positionals };
}

function container() {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
  });
}

type CliContainer = ReturnType<typeof container>;

// A manager keeps its verbs on the prototype, so spreading one drops them.
function stubManager<T extends object>(manager: T, overrides: Partial<T>): T {
  return new Proxy(manager, {
    get: (target, key) => (key in overrides ? overrides[key as keyof T] : Reflect.get(target, key)),
  });
}

// The mock provider sorts nothing, so the model's half is fixed here: what a model would return
// for the fixture vault. Collection, merging, writing and promotion all run for real.
const fixedExtraction = coerceNoteExtraction({
  notes: [
    { id: '달의 문/인물/하나.md', kinds: ['character'] },
    { id: '달의 문/인물/준.md', kinds: ['character'] },
    { id: '달의 문/씬/1 만조.md', kinds: ['scene'] },
    { id: '달의 문/씬/2 등대의 밤.md', kinds: ['scene'] },
    { id: '달의 문/컨셉.md', kinds: ['premise'] },
  ],
  entities: [
    {
      type: 'character',
      name: '하나',
      suggestedId: 'hana',
      role: 'main',
      description: ['등대지기의 손녀.'],
      desire: ['달의 문 너머를 보고 싶다'],
      attributes: [{ key: 'age', value: '19' }],
      relations: [{ target: '준', type: '소꿉친구' }],
      sourceNotes: ['달의 문/인물/하나.md'],
    },
    {
      type: 'character',
      name: '준',
      suggestedId: 'jun',
      role: 'supporting',
      description: ['항구에서 배를 고치는 청년.'],
      sourceNotes: ['달의 문/인물/준.md'],
    },
    {
      type: 'background',
      name: '항구',
      suggestedId: 'harbor',
      senses: ['소금기 섞인 바람'],
      characterNames: ['준'],
      sourceNotes: ['달의 문/인물/준.md'],
    },
  ],
  scenes: [
    {
      title: '만조',
      slug: 'high-tide',
      summary: '만조의 밤, 하나가 항구에서 문이 열리는 것을 본다.',
      characterNames: ['하나'],
      locationName: '항구',
      sourceNote: '달의 문/씬/1 만조.md',
    },
    {
      title: '등대의 밤',
      slug: 'lighthouse-night',
      summary: '하나와 준이 등대에 올라 기록을 찾는다.',
      characterNames: ['하나', '준'],
      sourceNote: '달의 문/씬/2 등대의 밤.md',
    },
  ],
  premise: ['해양 미스터리'],
});

// 모델이 비워 둔 칸은 값이 undefined 인 키로 남는다.
const fixedSynthesis = {
  setting: { genre: '해양 미스터리', audience: undefined, concept: '만조에만 열리는 문' },
  synopsis: { logline: '만조에만 열리는 문을 둘러싼 이야기.', mainConflicts: [], styleRules: [] },
};

function withFixedModel(real: CliContainer): CliContainer {
  return {
    ...real,
    notes: stubManager(real.notes, {
      plan: async (request: PlanNoteAbsorbRequest) => ({
        ok: true as const,
        plan: await planFor(request),
      }),
    }),
  };
}

async function planFor(request: PlanNoteAbsorbRequest) {
  const cards = readdirSync(join(workspace, 'character'))
    .filter((name) => name.endsWith('.card') && !name.startsWith('.') && name !== 'sample.card')
    .map((name) => ({
      type: 'character' as const,
      id: name.replace(/\.card$/, ''),
      name: name === 'hana.card' ? '하나' : name,
      role: 'main' as const,
      description: ['등대지기의 손녀.'],
      attributes: { age: '17' },
    }));
  const sceneFiles = readdirSync(join(workspace, 'scene')).filter((name) =>
    /^\d+-[a-z0-9-]+\.card$/.test(name),
  );

  return buildNoteAbsorbPlan({
    notes: request.bundle.notes,
    extractions: [fixedExtraction],
    synthesis: fixedSynthesis,
    cards,
    scenes: sceneFiles.map((name) =>
      parseScene(readFileSync(join(workspace, 'scene', name), 'utf8'), name),
    ),
    scenePrefixDigits: 2,
  });
}

async function run(verb: string, parsed: ParsedArguments, target: CliContainer = container()) {
  const handler = commands[verb];
  if (!handler) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await handler({ container: target, args: parsed });
}

function absorbArgs(flags: Record<string, string | boolean> = {}): ParsedArguments {
  return args(['notes', 'absorb'], flags, [vault]);
}

function cardFiles(directory: string): string[] {
  return readdirSync(join(workspace, directory))
    .filter((name) => name.endsWith('.card'))
    .sort();
}

beforeEach(() => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-notes-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-notes-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('notes absorb', () => {
  beforeEach(async () => {
    await run('init', args(['init'], { title: '달의 문' }));
  });

  it('stops at the estimate without --yes when nobody can answer', async () => {
    const before = cardFiles('character');
    const outcome = await run('notes absorb', absorbArgs());

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('읽은 노트 7장 (링크로 따라온 노트 1장)');
    expect(outcome.message).toContain('링크로 읽음  세계관');
    expect(outcome.message).toContain('--yes');
    expect(cardFiles('character')).toEqual(before);
    expect(existsSync(join(workspace, '.storyboard', 'cache', 'notes', 'source.json'))).toBe(true);
    expect(existsSync(join(workspace, '.storyboard', 'cache', 'notes', 'plan.json'))).toBe(false);
  });

  it('runs the whole path on the mock provider and writes nothing it was not given', async () => {
    const outcome = await run('notes absorb', absorbArgs({ yes: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('카드 0장을 만들었습니다.');
    expect(existsSync(join(workspace, '.storyboard', 'cache', 'notes', 'plan.json'))).toBe(true);
  });

  it('shows the plan and writes nothing under --dry-run', async () => {
    const before = cardFiles('scene');
    const outcome = await run(
      'notes absorb',
      absorbArgs({ yes: true, 'dry-run': true }),
      withFixedModel(container()),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('인물  hana (하나) — 새 카드');
    expect(outcome.message).toContain('씬    01-high-tide 만조 ← 달의 문/씬/1 만조.md');
    expect(outcome.message).toContain('분류 못함  10 귀환');
    expect(outcome.message).toContain('작품 계약  장르: 해양 미스터리');
    expect(outcome.message).not.toContain('undefined');
    expect(cardFiles('scene')).toEqual(before);
    expect(existsSync(join(workspace, 'character', 'hana.card'))).toBe(false);
  });

  it('writes new cards, scenes and the synopsis, and leaves the contract alone', async () => {
    const outcome = await run(
      'notes absorb',
      absorbArgs({ yes: true }),
      withFixedModel(container()),
    );

    expect(outcome.ok).toBe(true);

    const hana = readFileSync(join(workspace, 'character', 'hana.card'), 'utf8');
    expect(hana).toContain('name: 하나');
    expect(hana).toContain('target: jun');
    expect(existsSync(join(workspace, 'character', 'profile', 'hana.png'))).toBe(true);
    expect(readFileSync(join(workspace, 'background', 'harbor.card'), 'utf8')).toContain('- jun');

    const scene = readFileSync(join(workspace, 'scene', '01-high-tide.card'), 'utf8');
    expect(scene).toContain('location: harbor');
    expect(cardFiles('scene')).toContain('02-lighthouse-night.card');

    expect(
      readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8'),
    ).toContain('만조에만 열리는 문을 둘러싼 이야기.');

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { genre?: string } };
    expect(project.setting?.genre).toBeUndefined();
    expect(outcome.message).toContain("storyboard project set --genre '해양 미스터리'");
  });

  it('turns notes about an existing card into candidates that card promote applies', async () => {
    const hanaPath = join(workspace, 'character', 'hana.card');
    writeFileSync(
      hanaPath,
      'type: character\nid: hana\nname: 하나\nrole: main\nattributes:\n  age: 17\ndescription:\n  - 등대지기의 손녀.\n',
    );
    const before = readFileSync(hanaPath, 'utf8');

    const absorbed = await run(
      'notes absorb',
      absorbArgs({ yes: true }),
      withFixedModel(container()),
    );

    expect(absorbed.message).toContain('기존 카드 hana 에 대한 내용은 후보로 남겼습니다');
    expect(readFileSync(hanaPath, 'utf8')).toBe(before);

    const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
    expect(preview.message).toContain('노트에서  hana (하나) 변경');
    expect(readFileSync(hanaPath, 'utf8')).toBe(before);

    const promoted = await run('card promote', args(['card', 'promote']));
    expect(promoted.ok).toBe(true);
    expect(promoted.message).toBe('카드 1개를 갱신했습니다.');

    const after = readFileSync(hanaPath, 'utf8');
    expect(after).toContain("age: '19'");
    expect(after).toContain('달의 문 너머를 보고 싶다');
    expect(existsSync(join(workspace, '.storyboard', 'cache', 'notes', 'candidates.json'))).toBe(
      false,
    );

    const again = await run('card promote', args(['card', 'promote']));
    expect(again.message).toBe('승격할 후보가 없습니다.');
  });

  it('refuses a missing location and a Notion page without a token', async () => {
    const missing = await run('notes absorb', args(['notes', 'absorb']));
    expect(missing.ok).toBe(false);

    const notion = await run(
      'notes absorb',
      args(['notes', 'absorb'], {}, [
        'https://www.notion.so/team/Moon-1429989fe8ac4effbc8f57f56486db54',
      ]),
    );
    expect(notion.ok).toBe(false);
    expect(notion.message).toContain('storyboard notes connect notion');
  });
});

describe('init --from-notes', () => {
  it('creates the workspace and fills the empty contract fields, keeping explicit flags', async () => {
    const real = container();
    const outcome = await run(
      'init',
      args(['init'], { title: '달의 문', genre: '판타지', 'from-notes': vault, yes: true }),
      withFixedModel(real),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('작품 계약의 빈 칸을 채웠습니다: 콘셉트');

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { genre?: string; concept?: string } };
    expect(project.setting).toMatchObject({ genre: '판타지', concept: '만조에만 열리는 문' });
    expect(existsSync(join(workspace, 'character', 'hana.card'))).toBe(true);
  });

  it('points an agent at notes absorb when it stopped at the estimate', async () => {
    const outcome = await run('init', args(['init'], { title: '달의 문', 'from-notes': vault }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('워크스페이스를 만들었습니다');
    expect(outcome.message).toContain('storyboard notes absorb');
    expect(outcome.message).toContain('--yes');
  });
});

describe('notes connect notion', () => {
  it('keeps the token in the secrets file only', async () => {
    const real = container();
    await real.notes.connectNotion('  secret_abc  ');

    expect(await real.secretStore.getNotionToken()).toBe('secret_abc');
    expect(readFileSync(join(home, 'secrets.json'), 'utf8')).toContain(
      'storyboard.integration.notion',
    );

    await real.notes.connectNotion('');
    expect(await real.secretStore.getNotionToken()).toBeUndefined();
  });
});
