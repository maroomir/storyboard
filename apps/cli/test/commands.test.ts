import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createDraft,
  NodeUri,
  parseDraft,
  parseSceneStem,
  parseStoryStructure,
  serializeDraft,
  serializeStoryStructure,
  STORYBOARD_RELATIVE_PATHS,
  type UsageRecord,
} from '@storyboard/story-model';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GenerateAndReviseDraftRequest } from '@storyboard/story-app';

import type { ParsedArguments } from '@/cliArguments';
import { commands, findCommand } from '@/commands/index';
import { createCliContainer } from '@/container';

import { createWorkspaceCaches, createWorkspaceRunLocks } from './fixtures/workspaceCacheFixture';
import { writeUnseededChapterPlan } from './fixtures/chapterOutline';
import { JournalStore, RunStore } from '@storyboard/story-engine';
import { readCardYaml, writeCardBundleFromYaml } from './fixtures/cardBundles';
import {
  listSceneStems,
  readSceneCardYaml,
  readSceneState,
  listDraftRevisions,
  writeSceneBundleFromYaml,
} from './fixtures/sceneBundles';

let home: string;
let workspace: string;
let previousHome: string | undefined;

function args(
  path: string[],
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
): ParsedArguments {
  return { path, flags, positionals };
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function container() {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
  });
}

async function run(verb: string, parsed: ParsedArguments) {
  const command = findCommand(verb);
  if (!command) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await command.execute({ container: container(), args: parsed });
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await run('init', args(['init'], { title: '시그널' }));
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

function stubManager<T extends object>(manager: T, overrides: Partial<T>): T {
  return new Proxy(manager, {
    get: (target, key) => (key in overrides ? overrides[key as keyof T] : Reflect.get(target, key)),
  });
}

describe('project contract', () => {
  function settingOf(): Record<string, unknown> {
    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: Record<string, unknown> };
    return project.setting ?? {};
  }

  function askingContainer(texts: (string | undefined)[], choices: unknown[], announced: string[]) {
    return {
      ...container(),
      prompter: {
        shouldConfirmPaidRuns: false,
        askText: async () => texts.shift(),
        choose: async () => choices.shift(),
        announce: (line: string) => announced.push(line),
      },
    } as unknown as Parameters<(typeof commands)['init']>[0]['container'];
  }

  it('asks for the name and the contract when init runs at a terminal without a title', async () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
    const announced: string[] = [];

    const outcome = await findCommand('init')!.execute({
      container: askingContainer(['레벨 제로', ''], ['third-limited', 'omnibus'], announced),
      args: args(['init']),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('레벨 제로 워크스페이스를 만들었습니다');
    expect(settingOf()).toMatchObject({ pov: 'third-limited', composition: 'omnibus' });
    expect(settingOf().genre).toBeUndefined();
    expect(announced).toEqual([
      '┌  새 작품 만들기',
      '◇  작품 이름  › 레벨 제로',
      '◇  장르  › 나중에',
      '◇  시점  › 3인칭 제한적',
      '◇  구성  › 옴니버스',
      '└  만드는 중…',
    ]);
  });

  it('creates nothing when the person backs out of the onboarding', async () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));

    const outcome = await findCommand('init')!.execute({
      container: askingContainer(['레벨 제로', '판타지'], [undefined], []),
      args: args(['init']),
    });

    expect(outcome.message).toContain('취소했습니다');
    expect(existsSync(join(workspace, '.storyboard', 'project.json'))).toBe(false);
  });

  it('fills the contract from init flags', async () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));

    const outcome = await run(
      'init',
      args(['init'], {
        title: '시그널',
        genre: '하이틴 로맨스',
        audience: '10~20대',
        pov: 'third-limited',
        'target-words': '480000',
        chapters: '8',
        'scenes-per-chapter': '4',
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      pov: 'third-limited',
      targetWordCount: 480000,
      chapterCount: 8,
      scenesPerChapter: 4,
    });
  });

  it('reads a contract file and lets flags win over it', async () => {
    const file = join(home, 'contract.json');
    writeFileSync(
      file,
      JSON.stringify({ genre: '무협', audience: '성인', styleConstraints: ['단문'] }),
    );

    const outcome = await run(
      'project set',
      args(['project', 'set'], { from: file, genre: '하이틴 로맨스' }),
    );

    expect(outcome.ok).toBe(true);
    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      audience: '성인',
      styleConstraints: ['단문'],
    });
  });

  it('keeps the keys it was not given', async () => {
    await run(
      'project set',
      args(['project', 'set'], { genre: '하이틴 로맨스', audience: '10~20대' }),
    );
    await run('project set', args(['project', 'set'], { 'target-words': '480000' }));

    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      audience: '10~20대',
      targetWordCount: 480000,
    });
  });

  it('refuses a point of view the format does not define', async () => {
    const outcome = await run('project set', args(['project', 'set'], { pov: 'omniscient' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('third-limited');
  });

  it('refuses a non-integer word count instead of writing NaN', async () => {
    const outcome = await run('project set', args(['project', 'set'], { 'target-words': '사만' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('양의 정수');
  });
});

describe('card create', () => {
  it('needs a description to fill the card from', async () => {
    const outcome = await run('card create', args(['card', 'create'], { name: '하나' }, ['character']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('card create character "<설명>"');
  });

  it('gives a card whose name makes no slug a numbered new-character slug', async () => {
    const outcome = await run(
      'card create',
      args(['card', 'create'], { name: '서진아' }, ['character', '무뚝뚝한 열일곱 살 궁수']),
    );

    expect(outcome.ok, outcome.message).toBe(true);
    expect(existsSync(join(workspace, 'character', 'new-character.card'))).toBe(true);
    expect(outcome.message).toContain('비어 있음:');
    expect(outcome.message).toContain('storyboard card interview new-character');
  });

  it('uses the explicit slug when one is given', async () => {
    const outcome = await run(
      'card create',
      args(['card', 'create'], { name: '서진아', id: 'seo-jina' }, ['character', '궁수']),
    );

    expect(outcome.ok, outcome.message).toBe(true);
    expect(await readCardYaml(workspace, 'seo-jina')).toContain('name: 서진아');
  });

  it('rejects an explicit slug that is not file-name safe', async () => {
    const outcome = await run(
      'card create',
      args(['card', 'create'], { name: '서진아', id: 'Seo Jina' }, ['character', '궁수']),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('영소문자');
  });

  it('refuses an explicit slug a card already holds instead of numbering it', async () => {
    await run('card create', args(['card', 'create'], { name: '하나', id: 'hana' }, ['character', '궁수']));

    const outcome = await run(
      'card create',
      args(['card', 'create'], { name: '한아', id: 'hana' }, ['character', '궁수']),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('이미 있는 카드입니다: hana');
    expect(existsSync(join(workspace, 'character', 'hana-2.card'))).toBe(false);
  });

  it('still numbers a slug it derived from the name', async () => {
    await run('card create', args(['card', 'create'], { name: 'Hana' }, ['character', '궁수']));

    const outcome = await run('card create', args(['card', 'create'], { name: 'Hana' }, ['character', '궁수']));

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'character', 'hana-2.card'))).toBe(true);
  });

  it('writes nothing under --dry-run', async () => {
    const outcome = await run(
      'card create',
      args(['card', 'create'], { name: 'Hana', 'dry-run': true }, ['character', '궁수']),
    );

    expect(outcome.ok, outcome.message).toBe(true);
    expect(outcome.message).toContain('아무것도 쓰지 않았습니다');
    expect(existsSync(join(workspace, 'character', 'hana.card'))).toBe(false);
  });
});

describe('kind arguments', () => {
  it('refuses a card verb without a card type', async () => {
    const created = await run('card create', args(['card', 'create'], { name: 'Hana' }));
    const renamed = await run('card rename', args(['card', 'rename'], { to: 'jun' }, ['hana']));
    const recommended = await run('card recommend', args(['card', 'recommend'], {}, ['narrator']));

    expect(created.ok).toBe(false);
    expect(created.message).toContain('<character|background|narrator>');
    for (const outcome of [renamed, recommended]) {
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain('<character|background>');
    }
  });

  it('renames the card of the type named first', async () => {
    await run('card create', args(['card', 'create'], { name: 'Hana' }, ['character', '테스트용 카드']));

    const outcome = await run(
      'card rename',
      args(['card', 'rename'], { to: 'hana-seo' }, ['character', 'hana']),
    );

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'character', 'hana-seo.card'))).toBe(true);
    expect(existsSync(join(workspace, 'character', 'hana.card'))).toBe(false);
  });

  it('takes the check kind first and the scene second', async () => {
    const missingKind = await run('draft check', args(['draft', 'check'], {}, ['01-first']));
    const missingDraft = await run(
      'draft check',
      args(['draft', 'check'], {}, ['slop', '01-first']),
    );

    expect(missingKind.ok).toBe(false);
    expect(missingKind.message).toContain('<grammar|continuity|slop>');
    expect(missingDraft.ok).toBe(false);
    expect(missingDraft.message).toContain('초안이 없습니다: 01-first');
  });

  it('refuses a note source it cannot connect', async () => {
    const outcome = await run('notes connect', args(['notes', 'connect'], {}, ['evernote']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('notion');
  });
});

describe('scene create and scene seed', () => {
  it('numbers a new scene after the highest one, with or without a usable name', async () => {
    const first = await run('scene create', args(['scene', 'create'], { name: 'Night Market' }));
    const second = await run('scene create', args(['scene', 'create'], { name: '야시장' }));

    expect(first.data).toMatchObject({ stem: '001-night-market' });
    expect(second.data).toMatchObject({ stem: '002-scene-2' });
    expect(await readSceneCardYaml(workspace, '002-scene-2')).toContain('id: 002-scene-2');
  });

  it('seeds scenes from the chapter plan and refuses to overwrite without --force', async () => {
    const missing = await run('scene seed', args(['scene', 'seed']));
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('outline generate');

    mkdirSync(join(workspace, '.storyboard', 'outline'), { recursive: true });
    writeUnseededChapterPlan(
      workspace,
      [
        'version: 1.0.0',
        'acts:',
        '  - id: act-1',
        '    title: 1막',
        '    chapters:',
        '      - id: chapter-1',
        '        title: 1장',
        '        scenes:',
        '          - id: harbor',
        '            title: 항구',
        '            purpose: 하나가 항구에 닿는다',
        '',
      ].join('\n'),
    );

    const seeded = await run('scene seed', args(['scene', 'seed']));
    expect(seeded.ok).toBe(true);
    expect(seeded.data).toHaveLength(1);
    expect(listSceneStems(workspace).map((stem) => `${stem}.card`)).toEqual(seeded.data);

    const refused = await run('scene seed', args(['scene', 'seed']));
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('--force');

    const forced = await run('scene seed', args(['scene', 'seed'], { force: true }));
    expect(forced.ok).toBe(true);
  });
});

describe('card build', () => {
  function containerWith(targets: unknown[]) {
    const real = container();
    return {
      ...real,
      cards: stubManager(real.cards, {
        buildFromScenes: async () => ({ targets, snapshots: [] }),
      }),
    } as unknown as Parameters<(typeof commands)['card build']>[0]['container'];
  }

  it('writes the proposed cards instead of only printing them', async () => {
    const container = containerWith([
      {
        card: { type: 'character', id: 'seo-jina', name: '서진아', tags: [], traits: [] },
        uriId: 'seo-jina',
        isNew: true,
        requiresIdConfirmation: false,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    const outcome = await findCommand('card build')!.execute({
      container,
      args: args(['card', 'build']),
    });

    expect(outcome.ok).toBe(true);
    expect(await readCardYaml(workspace, 'seo-jina')).toContain(
      'name: 서진아',
    );
  });

  it('leaves the tree alone under --dry-run', async () => {
    const container = containerWith([
      {
        card: { type: 'character', id: 'seo-jina', name: '서진아', tags: [], traits: [] },
        uriId: 'seo-jina',
        isNew: true,
        requiresIdConfirmation: false,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    await findCommand('card build')!.execute({
      container,
      args: args(['card', 'build'], { 'dry-run': true }),
    });

    expect(existsSync(join(workspace, 'character', 'seo-jina.card'))).toBe(false);
  });

  it('leaves the changes to an existing card as a proposal under --propose', async () => {
    writeCardBundleFromYaml(workspace, 'type: character\nid: hana\nname: 하나\nrole: main\n');
    const container = containerWith([
      {
        card: { type: 'character', id: 'hana', name: '하나', role: 'main', tags: [], traits: [] },
        uriId: 'hana',
        isNew: false,
        requiresIdConfirmation: false,
        changes: [{ proposal: { kind: 'trait', id: 'trait-1', value: '몰리면 먼저 웃는다', sourceScenes: [] } }],
        sourceScenes: ['01-first'],
      },
    ]);

    const outcome = await findCommand('card build')!.execute({
      container,
      args: args(['card', 'build'], { propose: true }),
    });

    expect(outcome.ok, outcome.message).toBe(true);
    expect(outcome.message).toContain('있던 카드 hana 의 변경은 제안으로 남겼습니다');
    expect(await readCardYaml(workspace, 'hana')).not.toContain('몰리면 먼저 웃는다');
    const applied = await run('card apply', args(['card', 'apply'], {}, ['hana']));
    expect(applied.ok, applied.message).toBe(true);
    expect(await readCardYaml(workspace, 'hana')).toContain('몰리면 먼저 웃는다');
  });

  it('reports a new card whose name yields no id rather than inventing one', async () => {
    const container = containerWith([
      {
        card: { type: 'location', id: 'new-card-2', name: '방송실', tags: [] },
        uriId: 'new-card-2',
        isNew: true,
        requiresIdConfirmation: true,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    const outcome = await findCommand('card build')!.execute({
      container,
      args: args(['card', 'build']),
    });

    expect(outcome.message).toContain('방송실');
    expect(existsSync(join(workspace, 'background', 'new-card-2.card'))).toBe(false);
  });
});

describe('manuscript review --show', () => {
  it('reads the last revision plan without calling a model', async () => {
    const none = await run('manuscript review', args(['manuscript', 'review'], { show: true }));
    expect(none.message).toBe('수정 계획이 없습니다. storyboard manuscript review 로 검수하세요.');

    const caches = createWorkspaceCaches();
    const { RevisionPlanRecorder } = await import('@storyboard/story-engine');
    const { NodeFileSystem } = await import('@storyboard/story-node');
    await new RevisionPlanRecorder({ fileSystem: new NodeFileSystem(), caches }).replaceLatest(
      NodeUri.file(workspace),
      {
        version: '1.0.0',
        entries: [
          {
            sceneStem: '001-first',
            checkedAt: '2026-11-01T00:00:00.000Z',
            revisionCount: 2,
            remainingBlocking: 1,
            instructions: ['시점이 흔들린다'],
          },
        ],
      },
    );
    await caches.closeAll();

    const shown = await run('manuscript review', args(['manuscript', 'review'], { show: true }));
    expect(shown.message).toContain('001-first  검수 2회 · 남은 막힘 1');
    expect(shown.message).toContain('  - 시점이 흔들린다');
  });
});

describe('scene complete', () => {
  async function seedOneScene() {
    await run('scene create', args(['scene', 'create'], { name: 'first' }));
  }

  function containerProposing(fileName: string) {
    const real = container();
    return {
      ...real,
      novel: stubManager(real.novel, {
        completeScenes: async () => ({
          scenes: [
            {
              fileName,
              content: 'type: scene\nid: proposed\n',
              title: '제안',
              resolvedThreads: [],
              openThreads: [],
            },
          ],
          snapshots: [],
        }),
      }),
    } as unknown as Parameters<(typeof commands)['scene complete']>[0]['container'];
  }

  it('writes the proposed ending scenes instead of only printing them', async () => {
    await seedOneScene();

    const outcome = await run('scene complete', args(['scene', 'complete']));

    expect(outcome.ok).toBe(true);
    const written = (outcome.data as { written: string[] }).written;
    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(workspace, 'scene', `002-${(written[0] as string).replace(/^\d+-/, '')}`))).toBe(
      true,
    );
  });

  it('skips a file that already exists', async () => {
    await seedOneScene();
    const container = containerProposing('001-first.card');
    const before = await readSceneCardYaml(workspace, '001-first');

    const outcome = await findCommand('scene complete')!.execute({
      container,
      args: args(['scene', 'complete']),
    });

    expect((outcome.data as { skipped: string[] }).skipped).toContain('001-first.card');
    expect(await readSceneCardYaml(workspace, '001-first')).toBe(before);
  });

  it('leaves the tree alone under --dry-run', async () => {
    await seedOneScene();
    const before = readdirSync(join(workspace, 'scene')).length;

    await run('scene complete', args(['scene', 'complete'], { 'dry-run': true }));

    expect(readdirSync(join(workspace, 'scene')).length).toBe(before);
  });
});

describe('scene create', () => {
  it('falls back to a numbered slug for a name with no ascii', async () => {
    const outcome = await run('scene create', args(['scene', 'create'], { name: '첫 방송' }));

    expect(outcome.ok).toBe(true);
    expect(listSceneStems(workspace)).toEqual(['001-scene-1']);
  });
});

describe('scene rename', () => {
  it('renames the scene through the shared engine and refuses a number change', async () => {
    await run('scene create', args(['scene', 'create'], { name: 'first' }));
    await run('scene create', args(['scene', 'create'], { name: 'second' }));

    const renamed = await run(
      'scene rename',
      args(['scene', 'rename'], { to: '001-opening' }, ['001-first']),
    );
    const refused = await run(
      'scene rename',
      args(['scene', 'rename'], { to: '002-opening' }, ['001-opening']),
    );

    expect(renamed.ok).toBe(true);
    expect(listSceneStems(workspace)).toEqual(['001-opening', '002-second']);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toContain('scene move');
  });
});

describe('pre-0.8 workspace repair', () => {
  it('tops up a stale gitignore block on re-init', async () => {
    writeFileSync(
      join(workspace, '.gitignore'),
      '# Storyboard generated files\n.storyboard/cache/\n.draft/\n',
    );

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(workspace, '.gitignore'), 'utf8')).toContain('manuscript/');
    expect(
      JSON.parse(readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8')).name,
    ).toBe('시그널');
  });

  it('writes the agent guides on init, with CLAUDE.md importing AGENTS.md', () => {
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain('storyboard doctor');
    expect(readFileSync(join(workspace, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });

  it('restores a missing agent guide on --repair and keeps an edited one', async () => {
    writeFileSync(join(workspace, 'AGENTS.md'), '# 작가가 고친 지침\n');
    rmSync(join(workspace, 'CLAUDE.md'));

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toBe('# 작가가 고친 지침\n');
    expect(readFileSync(join(workspace, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(outcome.data).toMatchObject({ addedAgentGuides: ['CLAUDE.md'] });
  });

  it('refuses a plain init on an existing workspace', async () => {
    const outcome = await run('init', args(['init'], { title: '새 제목' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('--repair');
  });

  it('refuses --repair outside a workspace', async () => {
    rmSync(join(workspace, '.storyboard'), { recursive: true, force: true });

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(false);
  });

  it('reports a stale gitignore block in doctor', async () => {
    writeFileSync(
      join(workspace, '.gitignore'),
      '# Storyboard generated files\n.storyboard/cache/\n.draft/\n',
    );

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('manuscript/');
  });

  it('names a card it cannot parse in doctor', async () => {
    mkdirSync(join(workspace, 'scene', '002-broken.card'), { recursive: true });
    writeFileSync(join(workspace, 'scene', '002-broken.card', 'card.yaml'), 'kind: scene\nid: [\n');

    const doctor = await run('doctor', args(['doctor']));

    expect(doctor.message).toContain('읽지 못한 카드');
    expect(doctor.message).toContain('002-broken.card');
  });

  it('reports missing beats in doctor', async () => {
    await writeSceneBundleFromYaml(
      workspace,
      ['type: scene', 'id: 001-first', 'summary: 진아가 사연을 읽었다.', ''].join('\n'),
    );
    await writeSceneBundleFromYaml(
      workspace,
      ['type: scene', 'id: 002-second', 'beats:', '  - 진아가 스튜디오에 들어선다.', ''].join('\n'),
    );

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('비트 없는 씬이 1개');
    expect(outcome.message).toContain('storyboard scene plot --all');
  });
});

describe('git repository', () => {
  function git(...gitArgs: string[]): string | undefined {
    try {
      return execFileSync('git', gitArgs, {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  }

  it('makes a new workspace a repository on main without committing', () => {
    expect(existsSync(join(workspace, '.git'))).toBe(true);
    expect(git('symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(git('rev-parse', '--verify', 'HEAD')).toBeUndefined();
    expect(readFileSync(join(workspace, '.gitignore'), 'utf8')).toContain('manuscript/');
  });

  it('creates the repository for an existing workspace on --repair', async () => {
    rmSync(join(workspace, '.git'), { recursive: true, force: true });

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('git 저장소도 만들었습니다');
    expect(git('rev-parse', '--is-inside-work-tree')).toBe('true');
  });

  it('leaves an existing repository untouched', async () => {
    git('symbolic-ref', 'HEAD', 'refs/heads/draft');

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toContain('git 저장소');
    expect(git('symbolic-ref', 'HEAD')).toBe('refs/heads/draft');
  });

  it('points a repository-less workspace at init --repair in doctor', async () => {
    rmSync(join(workspace, '.git'), { recursive: true, force: true });

    const outcome = await run('doctor', args(['doctor']));
    const { checks } = outcome.data as {
      checks: { label: string; status: string; fix?: string }[];
    };
    const check = checks.find((entry) => entry.label === 'git');

    expect(check?.status).toBe('warn');
    expect(check?.fix).toBe('storyboard init --repair');
  });
});

describe('state generate', () => {
  async function writeScene(stem: string): Promise<void> {
    await writeSceneBundleFromYaml(
      workspace,
      ['type: scene', `id: ${stem}`, 'purpose: 첫 방송', ''].join('\n'),
    );
  }

  function writeDraft(stem: string, text: string): void {
    writeFileSync(join(workspace, 'draft', `${stem}.md`), text);
  }

  function recordedHash(stem: string): string | undefined {
    return readSceneState(workspace, stem)?.inputHash;
  }

  it('records every scene with a draft in order, and keeps them on a second run', async () => {
    await writeScene('001-first');
    await writeScene('002-second');
    await writeScene('003-third');
    writeDraft('001-first', '첫 장면.\n');
    writeDraft('002-second', '둘째 장면.\n');

    const outcome = await run('state generate', args(['state', 'generate']));

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({
      recorded: ['001-first', '002-second'],
      kept: [],
      withoutDraft: ['003-third'],
      failures: [],
    });
    expect(recordedHash('001-first')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(recordedHash('002-second')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(readSceneState(workspace, '003-third')).toBeUndefined();

    const again = await run('state generate', args(['state', 'generate']));
    expect(again.ok).toBe(true);
    expect(again.data).toMatchObject({ recorded: [], kept: ['001-first', '002-second'] });
  });

  it('re-records only the named scenes with --force and refuses a range it cannot read', async () => {
    await writeScene('001-first');
    await writeScene('002-second');
    writeDraft('001-first', '첫 장면.\n');
    writeDraft('002-second', '둘째 장면.\n');
    await run('state generate', args(['state', 'generate']));

    const forced = await run('state generate', args(['state', 'generate'], { force: true }, ['1']));
    expect(forced.ok).toBe(true);
    expect(forced.data).toMatchObject({ recorded: ['001-first'], kept: [] });

    const refused = await run('state generate', args(['state', 'generate'], {}, ['8-3']));
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('씬 범위');
  });
});

describe('scene plot', () => {
  async function writeScene(stem: string, extra: string[] = []): Promise<void> {
    await writeSceneBundleFromYaml(
      workspace,
      ['type: scene', `id: ${stem}`, 'purpose: 첫 방송', ...extra, ''].join('\n'),
    );
  }

  it('writes the proposed beats to the card', async () => {
    await writeScene('001-first');

    const outcome = await run('scene plot', args(['scene', 'plot'], {}, ['001-first']));

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({ stem: '001-first', written: true });
    const card = await readSceneCardYaml(workspace, '001-first');
    expect(card).toContain('beats:\n  - text: 모의 비트 하나\n  - text: 모의 비트 둘\n  - text: 모의 비트 셋\n');
    expect(card).toContain('purpose: 첫 방송');
  });

  it('keeps existing beats unless --force, and never writes on --dry-run', async () => {
    await writeScene('001-first', ['beats:', '  - 창작자가 다듬은 비트']);

    const kept = await run('scene plot', args(['scene', 'plot'], {}, ['001-first']));
    expect(kept.ok).toBe(true);
    expect(kept.message).toContain('--force');
    expect((await readSceneCardYaml(workspace, '001-first'))).toContain(
      '창작자가 다듬은 비트',
    );

    const dry = await run(
      'scene plot',
      args(['scene', 'plot'], { force: true, 'dry-run': true }, ['001-first']),
    );
    expect(dry.data).toMatchObject({
      written: false,
      beats: ['모의 비트 하나', '모의 비트 둘', '모의 비트 셋'],
    });
    expect((await readSceneCardYaml(workspace, '001-first'))).toContain(
      '창작자가 다듬은 비트',
    );

    const forced = await run('scene plot', args(['scene', 'plot'], { force: true }, ['001-first']));
    expect(forced.data).toMatchObject({ written: true });
    expect((await readSceneCardYaml(workspace, '001-first'))).not.toContain(
      '창작자가 다듬은 비트',
    );
  });

  it('fills only the scenes without beats on --all', async () => {
    await writeScene('001-first');
    await writeScene('002-second', ['beats:', '  - 이미 있는 비트']);

    const outcome = await run('scene plot', args(['scene', 'plot'], { all: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({ proposed: 1, failures: [] });
    expect((await readSceneCardYaml(workspace, '002-second'))).toContain(
      '이미 있는 비트',
    );
    expect((await readSceneCardYaml(workspace, '001-first'))).toContain(
      '모의 비트 하나',
    );
  });

  it('requires a stem without --all', async () => {
    const outcome = await run('scene plot', args(['scene', 'plot']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('scene plot 001-scene-1-1');
  });
});

describe('draft generate progress', () => {
  it('logs the pipeline stage and section index', async () => {
    const logged: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      logger: silentLogger,
      progress: { update: ({ line }: { line: string }) => logged.push(line), finish: () => {} },
      drafts: stubManager(real.drafts, {
        generate: async (request: {
          onPipelineProgress?: (stage: string, current: number, total: number) => void;
        }) => {
          request.onPipelineProgress?.('expandSection', 2, 3);
          return { ok: true, kind: 'generated', draftUri: real.workspaceRoot, warnings: [] };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], {}, ['01-first']),
    });

    expect(logged).toEqual(['살붙임 2/3']);
  });
});

describe('draft generate --all progress', () => {
  it('names the stage on each log line, so a piped log does not repeat one line', async () => {
    const logged: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      progress: { update: ({ line }: { line: string }) => logged.push(line), finish: () => {} },
      drafts: stubManager(real.drafts, {
        generateAll: async (request: { onProgress?: (progress: unknown) => void }) => {
          const scene = { current: 2, total: 3, label: '02-blank-pages.card' };
          request.onProgress?.({ ...scene, kind: 'prepared' });
          request.onProgress?.({
            ...scene,
            kind: 'pipeline',
            stage: 'expandSection',
            stageCurrent: 1,
            stageTotal: 3,
          });
          request.onProgress?.({ ...scene, kind: 'saving' });
          return {
            kind: 'completed',
            ok: true,
            summary: { cacheHits: 0, failureLabels: [], failures: 0, generated: 1, sceneCount: 3 },
          };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], { all: true }),
    });

    expect(logged).toEqual([
      '2/3 02-blank-pages.card · 준비',
      '2/3 02-blank-pages.card · 살붙임 1/3',
      '2/3 02-blank-pages.card · 저장',
    ]);
  });
});

describe('novel generate progress', () => {
  it('logs the stage by its name, not its id', async () => {
    const logged: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      progress: { update: ({ line }: { line: string }) => logged.push(line), finish: () => {} },
      novel: stubManager(real.novel, {
        run: async (request: { onProgress?: (stage: string, message: string) => void }) => {
          request.onProgress?.('outline', '아웃라인 생성 중…');
          return {
            outcome: 'completed',
            message: '장편 생성을 완료했습니다.',
            spending: { costUsd: 0, isOverBudget: false },
          };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['novel generate']>[0]['container'];

    await findCommand('novel generate')!.execute({
      container: stubbed,
      args: args(['novel', 'generate']),
    });

    expect(logged).toEqual(['아웃라인: 아웃라인 생성 중…']);
  });
});

describe('draft generate --all pause', () => {
  it('stops at a scene boundary when asked and says what is left', async () => {
    const real = container();
    let shouldPause: (() => boolean) | undefined;
    const stubbed = {
      ...real,
      drafts: stubManager(real.drafts, {
        generateAll: async (request: { shouldPause?: () => boolean }) => {
          shouldPause = request.shouldPause;
          real.pauseRequests.request();
          return {
            kind: 'completed',
            ok: true,
            summary: {
              cacheHits: 0,
              failureLabels: [],
              failures: 0,
              generated: 1,
              sceneCount: 3,
              pausedWithRemaining: 2,
            },
          };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    const outcome = await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], { all: true }),
    });

    expect(shouldPause?.()).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('남은 씬 2개');
  });
});

describe('paid run confirmation', () => {
  it('runs nothing when the person at the interactive screen declines', async () => {
    const real = container();
    let hasRun = false;
    const stubbed = {
      ...real,
      prompter: { shouldConfirmPaidRuns: true, choose: async () => false },
      drafts: stubManager(real.drafts, {
        generateAll: async () => {
          hasRun = true;
          return { kind: 'no_scenes', ok: false };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    const outcome = await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], { all: true }),
    });

    expect(hasRun).toBe(false);
    expect(outcome.message).toContain('취소했습니다');
  });
});

describe('draft generate warnings', () => {
  it('reports the draft warnings on stderr and in the json data', async () => {
    const warned: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      logger: {
        ...silentLogger,
        warn: (message: string) => warned.push(message),
      },
      progress: { update: ({ line }: { line: string }) => warned.push(line), finish: () => {} },
      drafts: stubManager(real.drafts, {
        generateAndRevise: async (request: GenerateAndReviseDraftRequest) => {
          const generation = {
            ok: true,
            kind: 'generated',
            draftUri: real.workspaceRoot,
            warnings: ['1구간: 목표 3,000자에 크게 못 미칩니다 (1,650자)'],
          } as const;
          await request.onDraftReady?.(generation);
          request.onReviseProgress?.('검사 중 (1/1)');
          return { generation, revision: undefined };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    const outcome = await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], {}, ['01-first']),
    });

    expect(outcome.ok).toBe(true);
    expect(warned).toEqual(['1구간: 목표 3,000자에 크게 못 미칩니다 (1,650자)', '검사 중 (1/1)']);
    expect((outcome.data as { warnings: string[] }).warnings).toHaveLength(1);
  });
});

describe('draft generate --no-revise', () => {
  it('asks the manager not to review the new draft', async () => {
    const requests: GenerateAndReviseDraftRequest[] = [];
    const real = container();
    const stubbed = {
      ...real,
      progress: { update: () => {}, finish: () => {} },
      drafts: stubManager(real.drafts, {
        generateAndRevise: async (request: GenerateAndReviseDraftRequest) => {
          requests.push(request);
          return {
            generation: { ok: true, kind: 'generated', draftUri: real.workspaceRoot, warnings: [] },
            revision: undefined,
          };
        },
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], { 'no-revise': true }, ['01-first']),
    });
    await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], {}, ['01-first']),
    });

    expect(requests.map((request) => request.isReviseAllowed)).toEqual([false, true]);
  });
});

describe('draft generate after a failed review', () => {
  it('succeeds with the review status and a warning when the rewrite timed out', async () => {
    const warned: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      logger: { ...silentLogger, warn: (message: string) => warned.push(message) },
      progress: { update: () => {}, finish: () => {} },
      drafts: stubManager(real.drafts, {
        generateAndRevise: async () => ({
          generation: { ok: true, kind: 'generated', draftUri: real.workspaceRoot, warnings: [] },
          revision: {
            passed: false,
            revisionCount: 0,
            remainingBlocking: 2,
            cancelled: false,
            instructions: [],
            preservedOriginal: false,
            failure: {
              stage: 'revise',
              kind: 'timeout',
              message: '600초 안에 끝나지 않아 중단했습니다.',
            },
          },
        }),
      } as never),
    } as unknown as Parameters<(typeof commands)['draft generate']>[0]['container'];

    const outcome = await findCommand('draft generate')!.execute({
      container: stubbed,
      args: args(['draft', 'generate'], {}, ['01-first']),
    });

    expect(outcome.ok).toBe(true);
    const data = outcome.data as { draft: string; warnings: string[]; revise: { status: string } };
    expect(data.draft).toBeTruthy();
    expect(data.revise.status).toBe('timeout');
    expect(data.warnings).toHaveLength(1);
    expect(warned[0]).toContain('600초');
  });
});

describe('narrator verbs', () => {
  it('reports no narrator cards on a fresh workspace', async () => {
    const outcome = await run('card list', args(['card', 'list'], {}, ['narrator']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('작품 계약의 시점');
  });

  it('creates a narrator card and lists it', async () => {
    const created = await run(
      'card create',
      args(
        ['card', 'create'],
        { person: 'first', focal: 'hana', voice: '건조한 단문, 자기 비하' },
        ['narrator', 'hana-first'],
      ),
    );

    expect(created.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'hana-first.card'))).toBe(true);

    const listed = await run('card list', args(['card', 'list'], {}, ['narrator']));
    expect(listed.message).toContain('hana-first');
    expect(listed.message).toContain('1인칭');
  });

  it('refuses a person the format does not define', async () => {
    const outcome = await run(
      'card create',
      args(['card', 'create'], { person: 'fourth' }, ['narrator', 'x']),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('first, second, third');
  });

  it('refuses an id that is not a valid file name', async () => {
    const outcome = await run('card create', args(['card', 'create'], {}, ['narrator', '하나']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('영소문자');
  });

  it('refuses to overwrite an existing narrator', async () => {
    await run('card create', args(['card', 'create'], {}, ['narrator', 'hana-first']));
    const again = await run('card create', args(['card', 'create'], {}, ['narrator', 'hana-first']));

    expect(again.ok).toBe(false);
    expect(again.message).toContain('이미 있습니다');
  });

  it('shows one narrator and removes it', async () => {
    await run(
      'card create',
      args(['card', 'create'], { person: 'first', knowledge: 'retrospective' }, ['narrator', 'old-hana']),
    );

    const shown = await run('card show', args(['card', 'show'], {}, ['old-hana']));
    expect(shown.message).toContain('회고');

    const removed = await run('card remove', args(['card', 'remove'], {}, ['old-hana']));
    expect(removed.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'old-hana.card'))).toBe(false);
  });

  it('reports a narrator that does not exist', async () => {
    const outcome = await run('card show', args(['card', 'show'], {}, ['ghost']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('ghost');
  });
});

describe('composition presets', () => {
  it('creates omnibus threads from the contract flags', async () => {
    const outcome = await run(
      'project set',
      args(['project', 'set'], { composition: 'omnibus', episodes: '4' }),
    );

    expect(outcome.ok).toBe(true);

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { composition?: string; threads?: Record<string, unknown> } };
    const structure = parseStoryStructure(
      readFileSync(join(workspace, '.storyboard', 'structure.yaml'), 'utf8'),
      'structure.yaml',
    );

    expect(project.setting?.composition).toBe('omnibus');
    expect(project.setting?.threads).toBeUndefined();
    expect(structure.threads.map((thread) => thread.id)).toEqual(['ep1', 'ep2', 'ep3', 'ep4']);
  });

  it('writes narrator cards for an alternating point of view', async () => {
    const outcome = await run(
      'project set',
      args(['project', 'set'], {
        composition: 'alternating-pov',
        'pov-characters': 'hana,jun',
        pov: 'first',
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'hana-pov.card'))).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'jun-pov.card'))).toBe(true);
  });

  it('refuses a composition the format does not define', async () => {
    const outcome = await run(
      'project set',
      args(['project', 'set'], { composition: 'anthology' }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('omnibus');
  });
});

describe('scene show', () => {
  it('reports the narration a scene will be generated with', async () => {
    await run('project set', args(['project', 'set'], { pov: 'first' }));
    await run('scene create', args(['scene', 'create'], { name: 'night market' }));

    const outcome = await run('scene show', args(['scene', 'show'], {}, ['001-night-market']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('시점: 1인칭');
    expect(outcome.message).toContain('줄기: main');
  });

  it('reports the narrator card a scene names', async () => {
    await run(
      'card create',
      args(['card', 'create'], { person: 'third', knowledge: 'omniscient' }, ['narrator', 'wide']),
    );
    await run('scene create', args(['scene', 'create'], { name: 'bridge' }));
    declareThreads({ ep2: { title: '2화' } });
    await writeSceneBundleFromYaml(
      workspace,
      'type: scene\nid: 001-bridge\nnarrator: wide\nthread: ep2\n',
    );

    const outcome = await run('scene show', args(['scene', 'show'], {}, ['001-bridge']));

    expect(outcome.message).toContain('전지');
    expect(outcome.message).toContain('줄기: ep2');
  });

  it('falls back to the narrator its chapter names', async () => {
    await run(
      'card create',
      args(['card', 'create'], { person: 'third', knowledge: 'omniscient' }, ['narrator', 'wide']),
    );
    await run('scene create', args(['scene', 'create'], { name: 'harbor' }));
    mkdirSync(join(workspace, '.storyboard', 'outline'), { recursive: true });
    writeUnseededChapterPlan(
      workspace,
      [
        'version: 1.0.0',
        'acts:',
        '  - id: act-1',
        '    title: 1막',
        '    chapters:',
        '      - id: chapter-1',
        '        title: 1장',
        '        narrator: wide',
        '        scenes:',
        '          - id: harbor',
        '            title: 항구',
        '            purpose: 하나가 항구에 닿는다',
        '',
      ].join('\n'),
    );

    const outcome = await run('scene show', args(['scene', 'show'], {}, ['001-harbor']));

    expect(outcome.message).toContain('전지');
  });

  function declareThreads(threads: Record<string, { title: string }>): void {
    const structureFile = join(workspace, ...STORYBOARD_RELATIVE_PATHS.structure.split('/'));
    const current = existsSync(structureFile)
      ? parseStoryStructure(readFileSync(structureFile, 'utf8'))
      : { threads: [{ id: 'main', title: '본편' }], scenes: [] };
    const added = Object.entries(threads)
      .filter(([id]) => !current.threads.some((thread) => thread.id === id))
      .map(([id, thread]) => ({ id, title: thread.title }));
    writeFileSync(
      structureFile,
      serializeStoryStructure({ ...current, threads: [...current.threads, ...added] }),
    );
  }

});

describe('doctor: interrupted scene rename', () => {
  async function writeScene(stem: string, title = '야시장'): Promise<void> {
    await writeSceneBundleFromYaml(workspace, `type: scene\nid: ${stem}\ntitle: ${title}\n`);
  }

  async function writeRenumberingJournal(): Promise<void> {
    const caches = createWorkspaceCaches();
    new JournalStore(await caches.open(NodeUri.file(workspace))).beginSceneRename([
      {
        sceneId: '00000000-0000-4000-8000-000000000001',
        target: 'bundle',
        from: 'scene/009-gone.card',
        to: 'scene/001-gone.card',
      },
    ]);
    await caches.closeAll();
  }

  it('names the renumbering its journal left unfinished', async () => {
    await writeScene('001-night-market');
    await writeRenumberingJournal();

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('1단계 중 0단계에서 끊겼습니다');
    expect(outcome.message).toContain('storyboard init --repair');
  });

  it('stops reporting once init --repair finishes the journal', async () => {
    await writeScene('001-night-market');
    await writeRenumberingJournal();

    await run('init', args(['init'], { repair: true }));
    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).not.toContain('씬 번호 다시 매기기');
  });

  it('reports a draft left with no card', async () => {
    await writeScene('001-moon-market');
    writeFileSync(join(workspace, 'draft', '001-night-market.md'), '등불 아래.\n');

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('draft/001-night-market.md 의 씬 카드가 없습니다');
    expect(outcome.message).not.toContain('단계에서 끊겼습니다');
  });

  it('stays quiet about scenes that only look alike', async () => {
    await writeScene('001-night-market');
    await writeScene('002-dawn', '새벽');

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).not.toContain('씬 번호 다시 매기기');
    expect(outcome.message).not.toContain('카드 없는 씬 파일');
  });
});

describe('scene rename: two fresh scenes are not a cut-off rename', () => {
  beforeEach(async () => {
    await run('scene create', args(['scene', 'create'], { name: 'opening' }));
    await run('scene create', args(['scene', 'create'], { name: 'storm' }));
  });

  it('does not report a rename in doctor', async () => {
    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).not.toContain('씬 번호 다시 매기기');
  });

  it('refuses a number change and keeps both cards', async () => {
    const outcome = await run(
      'scene rename',
      args(['scene', 'rename'], { to: '002-storm' }, ['001-opening']),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('scene move');
    expect(listSceneStems(workspace)).toEqual(['001-opening', '002-storm']);
  });
});

describe('draft edit and draft augment', () => {
  const originalBody = '첫 문단.\n\n둘째 문단.\n';

  async function writeSceneWithDraft(): Promise<void> {
    await run('scene create', args(['scene', 'create'], { name: 'night market' }));
    mkdirSync(join(workspace, 'draft'), { recursive: true });
    writeFileSync(
      join(workspace, 'draft', '001-night-market.md'),
      serializeDraft(
        createDraft({ sceneStem: '001-night-market', format: 'novel', body: originalBody }),
      ),
    );
  }

  function draftBody(): string {
    return parseDraft(readFileSync(join(workspace, 'draft', '001-night-market.md'), 'utf8')).body;
  }

  async function historyCount(): Promise<number> {
    return (await listDraftRevisions(workspace, '001-night-market')).length;
  }

  it.each([
    ['draft augment', {}],
    ['draft edit', { instruction: '더 짧게' }],
  ] as const)('%s writes the revision', async (verb, flags) => {
    await writeSceneWithDraft();

    const outcome = await run(verb, args(verb.split(' '), flags, ['001-night-market']));

    expect(outcome.ok).toBe(true);
    expect(draftBody()).not.toBe(originalBody);
    expect(draftBody()).toContain('[Mock AI: draftAugment]');
  });

  it.each([
    ['draft augment', {}],
    ['draft edit', { instruction: '더 짧게' }],
  ] as const)('%s keeps the previous draft as a revision', async (verb, flags) => {
    await writeSceneWithDraft();

    await run(verb, args(verb.split(' '), flags, ['001-night-market']));

    expect(await historyCount()).toBe(1);
  });

  it.each([
    ['draft augment', {}],
    ['draft edit', { instruction: '더 짧게' }],
  ] as const)('%s --dry-run leaves the draft alone', async (verb, flags) => {
    await writeSceneWithDraft();

    const outcome = await run(
      verb,
      args(verb.split(' '), { ...flags, 'dry-run': true }, ['001-night-market']),
    );

    expect(outcome.ok).toBe(true);
    expect(draftBody()).toBe(originalBody);
    expect(await historyCount()).toBe(0);
  });

  it('refuses an empty --lines range on --dry-run too', async () => {
    await writeSceneWithDraft();

    const outcome = await run(
      'draft edit',
      args(['draft', 'edit'], { instruction: '고쳐', lines: '99-120', 'dry-run': true }, [
        '001-night-market',
      ]),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe('대상 구간이 비어 있습니다.');
  });

  it('replaces only the --lines range', async () => {
    await writeSceneWithDraft();

    await run(
      'draft edit',
      args(['draft', 'edit'], { instruction: '고쳐', lines: '3-3' }, ['001-night-market']),
    );

    expect(draftBody().startsWith('첫 문단.\n\n[Mock AI: draftAugment]')).toBe(true);
  });
});

describe('spend that belongs to no scene', () => {
  it('charges the outline calls to the work', async () => {
    await run(
      'project set',
      args(['project', 'set'], {
        genre: '스릴러',
        audience: '성인',
        pov: 'third-limited',
        'target-words': '12000',
      }),
    );
    const records: UsageRecord[] = [];
    const recording = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '0.0.0',
      usageSink: { record: async (_root, usage) => void records.push(usage) },
    });

    await findCommand('novel generate')!.execute({
      container: recording,
      args: args(['novel', 'generate']),
    });

    const outlineRecords = records.filter((record) =>
      ['outlineSynopsis', 'chapterPlan'].includes(record.taskName),
    );
    expect(outlineRecords.map((record) => record.taskName)).toEqual([
      'outlineSynopsis',
      'chapterPlan',
    ]);
    expect(outlineRecords.map((record) => record.attribution.primary?.kind)).toEqual([
      'project',
      'project',
    ]);
  });
});

describe('spend of the calls that prepare a scene', () => {
  it('charges the grounding and beat proposals to the work, not the scene file', async () => {
    await run('scene create', args(['scene', 'create'], { name: 'night market' }));
    const roots: { readonly taskName: string; readonly root: string }[] = [];
    const recording = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '0.0.0',
      usageSink: {
        record: async (root, usage) =>
          void roots.push({ taskName: usage.taskName, root: (root as { fsPath: string }).fsPath }),
      },
    });

    await findCommand('draft generate')!.execute({
      container: recording,
      args: args(['draft', 'generate'], {}, ['001-night-market']),
    });
    await findCommand('scene plot')!.execute({
      container: recording,
      args: args(['scene', 'plot'], { force: true }, ['001-night-market']),
    });

    const setupCalls = roots.filter((call) => call.taskName === 'sceneBeats');
    expect(new Set(setupCalls.map((call) => call.taskName))).toEqual(new Set(['sceneBeats']));
    const workspaceRootPath: string = (recording.workspaceRoot as { fsPath: string }).fsPath;
    expect(setupCalls.map((call) => call.root)).toEqual(setupCalls.map(() => workspaceRootPath));
  });
});

describe('novel generate again', () => {

  async function startNovel(): Promise<void> {
    await run(
      'project set',
      args(['project', 'set'], {
        genre: '스릴러',
        audience: '성인',
        pov: 'third-limited',
        'target-words': '12000',
      }),
    );
    await run('novel generate', args(['novel', 'generate']));
  }

  async function leaveRunCutOff(): Promise<void> {
    const caches = createWorkspaceCaches();
    const runs = new RunStore(await caches.open(NodeUri.file(workspace)));
    const state = runs.findLatestNovelRun();
    expect(state).toBeDefined();
    if (state !== undefined) {
      runs.saveNovelRun({ ...state, status: 'running', completedStages: ['outline', 'seeds'] });
    }
    await caches.closeAll();
  }

  async function runAgain(answer?: 'resume' | 'restart') {
    const records: UsageRecord[] = [];
    const questions: string[] = [];
    const again = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: answer !== undefined,
      version: '0.0.0',
      usageSink: { record: async (_root, usage) => void records.push(usage) },
      ...(answer === undefined
        ? {}
        : {
            prompter: {
              choose: async <T>(request: { title: string; options: { value: T }[] }) => {
                questions.push(request.title);
                return request.options.find((option) => option.value === answer)?.value;
              },
              askText: async () => undefined,
              announce: () => undefined,
              shouldConfirmPaidRuns: false,
            },
          }),
    });

    await findCommand('novel generate')!.execute({
      container: again,
      args: args(['novel', 'generate']),
    });

    return { tasks: records.map((record) => record.taskName), questions };
  }

  function sceneFiles(): string[] {
    return readdirSync(join(workspace, 'scene')).sort();
  }

  it('continues a run whose process died without asking an agent', async () => {
    await startNovel();
    const scenesBefore = sceneFiles();
    await leaveRunCutOff();

    const { tasks, questions } = await runAgain();

    expect(questions).toEqual([]);
    expect(tasks).not.toContain('outlineSynopsis');
    expect(tasks).not.toContain('chapterPlan');
    expect(sceneFiles()).toEqual(scenesBefore);
  });

  it('asks a person whether to continue', async () => {
    await startNovel();
    await leaveRunCutOff();

    const { tasks, questions } = await runAgain('resume');

    expect(questions).toHaveLength(1);
    expect(tasks).not.toContain('outlineSynopsis');
  });

  it('treats a running state as cut off only when no app holds the lock', async () => {
    await startNovel();
    await leaveRunCutOff();
    const app = container();
    const lookup = () => app.novel.findResumableRun(app.workspaceRoot, { holdsRunLock: false });

    expect((await lookup())?.status).toBe('running');

    const caches = createWorkspaceCaches();
    await createWorkspaceRunLocks(caches).acquire(app.workspaceRoot, {
      owner: 'vscode',
      label: '장편 생성',
      pid: 1,
      hostname: 'test',
    });

    expect(await lookup()).toBeUndefined();
    await caches.closeAll();
  });

  it('starts over without rebuilding the outline or the scene cards that exist', async () => {
    await startNovel();
    const scenesBefore = sceneFiles();
    const firstScene = join(workspace, 'scene', scenesBefore[0] ?? '', 'card.yaml');
    writeFileSync(firstScene, `${readFileSync(firstScene, 'utf8')}# 작가 메모\n`);
    await leaveRunCutOff();

    const { tasks } = await runAgain('restart');

    expect(tasks).not.toContain('outlineSynopsis');
    expect(tasks).not.toContain('chapterPlan');
    expect(sceneFiles()).toEqual(scenesBefore);
    expect(readFileSync(firstScene, 'utf8')).toContain('# 작가 메모');
  });

  it('keeps a scene card that was renamed or renumbered to another width', async () => {
    await startNovel();
    const [firstStem] = sceneFiles().map((name) => name.replace(/\.card$/, ''));
    renameSync(
      join(workspace, 'scene', `${firstStem}.card`),
      join(workspace, 'scene', '001-opening.card'),
    );
    renameSync(
      join(workspace, 'draft', `${firstStem}.md`),
      join(workspace, 'draft', '001-opening.md'),
    );
    const scenesBefore = sceneFiles();
    const draftsBefore = readdirSync(join(workspace, 'draft')).sort();
    await leaveRunCutOff();

    await runAgain('restart');

    expect(sceneFiles()).toEqual(scenesBefore);
    expect(readdirSync(join(workspace, 'draft')).sort()).toEqual(draftsBefore);
  });
});

describe('novel generate on an empty work', () => {
  async function setContract(): Promise<void> {
    await run(
      'project set',
      args(['project', 'set'], {
        genre: '스릴러',
        audience: '성인',
        pov: 'third-limited',
        'target-words': '12000',
      }),
    );
  }

  async function generateRecording() {
    const records: UsageRecord[] = [];
    const recording = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '0.0.0',
      usageSink: { record: async (_root, usage) => void records.push(usage) },
    });
    const outcome = await findCommand('novel generate')!.execute({
      container: recording,
      args: args(['novel', 'generate']),
    });

    return { outcome, tasks: records.map((record) => record.taskName) };
  }

  it('makes the cards the chapter plan casts and runs to the end', async () => {
    await setContract();

    const { outcome } = await generateRecording();

    expect(outcome.ok, outcome.message).toBe(true);
    expect(await readCardYaml(workspace, 'hana')).toContain('name: 하나');
    expect(await readCardYaml(workspace, 'jun')).toContain('name: 준');
  });

  it('runs to the end in an omnibus work whose chapters name no thread', async () => {
    await setContract();
    await run('project set', args(['project', 'set'], { composition: 'omnibus', episodes: '2' }));

    const { outcome } = await generateRecording();

    expect(outcome.ok, outcome.message).toBe(true);
    expect(listSceneStems(workspace).length).toBeGreaterThan(0);
  });

  it('leaves a card that exists alone and asks only for the missing one', async () => {
    await setContract();
    await run('card create', args(['card', 'create'], { name: '한아', id: 'hana' }, ['character', '테스트용 카드']));
    const authored = await readCardYaml(workspace, 'hana');

    await generateRecording();

    expect(await readCardYaml(workspace, 'hana')).toBe(authored);
    expect(existsSync(join(workspace, 'character', 'jun.card'))).toBe(true);
  });

  it('calls nothing when every cast member has a card', async () => {
    await setContract();
    await run('card create', args(['card', 'create'], { name: '하나', id: 'hana' }, ['character', '테스트용 카드']));
    await run('card create', args(['card', 'create'], { name: '준', id: 'jun' }, ['character', '테스트용 카드']));

    const { tasks } = await generateRecording();

    expect(tasks).not.toContain('outlineCharacters');
  });
});
