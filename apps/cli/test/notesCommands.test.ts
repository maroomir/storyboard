import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildNoteAbsorbPlan,
  coerceNoteExtraction,
  NodeUri,
  type NoteAbsorbPlan,
} from '@storyboard/story-model';
import { type PlanNoteAbsorbRequest } from '@storyboard/story-engine';

import type { ParsedArguments } from '@/cliArguments';
import { commands, findCommand } from '@/commands/index';
import { createCliContainer } from '@/container';

import { readBundleText, readCardYaml, writeCardBundleFromYaml } from './fixtures/cardBundles';
import { readAbsorbPending, readAbsorbSessions } from './fixtures/absorbSessions';
import {
  listScenesFromBundles,
  readSceneCardYaml,
  readSceneFromBundles,
} from './fixtures/sceneBundles';

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

function stubManager<T extends object>(manager: T, overrides: Partial<T>): T {
  return new Proxy(manager, {
    get: (target, key) => (key in overrides ? overrides[key as keyof T] : Reflect.get(target, key)),
  });
}

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
      sampleLines: ['만조엔 문이 열려. 난 봤어.'],
      attributes: [{ key: 'age', value: '19' }],
      relations: [{ target: '준', type: '소꿉친구' }],
      canonFacts: [{ key: 'origin', value: '등대지기 집안에서 자랐다' }],
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

const fixedSynthesis = {
  setting: { genre: '해양 미스터리', audience: undefined, concept: '만조에만 열리는 문' },
  synopsis: { logline: '만조에만 열리는 문을 둘러싼 이야기.', mainConflicts: [], styleRules: [] },
};

function withFixedModel(
  real: CliContainer,
  reshape: (plan: NoteAbsorbPlan) => NoteAbsorbPlan = (plan) => plan,
): CliContainer {
  return {
    ...real,
    notes: stubManager(real.notes, {
      plan: async (request: PlanNoteAbsorbRequest) => ({
        ok: true as const,
        plan: reshape(await planFor(request)),
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
      name: name === 'hana.card' ? '하나' : name === 'jun.card' ? '준' : name,
      role: 'main' as const,
      description: ['등대지기의 손녀.'],
      attributes: { age: '17' },
    }));

  return buildNoteAbsorbPlan({
    notes: request.bundle.notes,
    extractions: [fixedExtraction],
    synthesis: fixedSynthesis,
    cards,
    scenes: [...(await listScenesFromBundles(workspace))],
  });
}

async function run(verb: string, parsed: ParsedArguments, target: CliContainer = container()) {
  const command = findCommand(verb);
  if (!command) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await command.execute({ container: target, args: parsed });
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
    const [session] = await readAbsorbSessions(workspace);
    expect(session?.bundle).toBeDefined();
    expect(session?.plan).toBeUndefined();
  });

  it('asks a person with the estimate in the question and writes nothing when declined', async () => {
    const questions: { title: string; details: readonly string[] }[] = [];
    const asking = {
      ...container(),
      prompter: {
        shouldConfirmPaidRuns: false,
        choose: async (request: { title: string; details: readonly string[] }) => {
          questions.push(request);
          return false;
        },
      },
    } as unknown as CliContainer;

    const outcome = await run('notes absorb', absorbArgs(), asking);

    expect(outcome.message).toContain('취소했습니다');
    expect(questions).toHaveLength(1);
    expect(questions[0]?.title).toBe('노트를 AI 로 정리할까요?');
    expect(questions[0]?.details.join('\n')).toContain('읽은 노트 7장');
    expect((await readAbsorbSessions(workspace))[0]?.plan).toBeUndefined();
  });

  it('runs the whole path on the mock provider and writes nothing it was not given', async () => {
    const outcome = await run('notes absorb', absorbArgs({ yes: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('카드 0장을 만들었습니다.');
    expect((await readAbsorbSessions(workspace))[0]?.plan).toBeDefined();
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
    expect(outcome.message).toContain('씬    001-high-tide 만조 ← 달의 문/씬/1 만조.md');
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

    const hana = await readCardYaml(workspace, 'hana');
    expect(hana).toContain('name: 하나');
    expect(hana).toContain('target: jun');
    expect(existsSync(join(workspace, 'character', 'hana.card', 'profile.png'))).toBe(true);
    expect(await readCardYaml(workspace, 'harbor')).toContain('name: 항구');

    expect(await readSceneCardYaml(workspace, '001-high-tide')).toContain('location: harbor');
    expect((await readSceneFromBundles(workspace, '001-high-tide'))?.summaryText).toBe(
      '만조의 밤, 하나가 항구에서 문이 열리는 것을 본다.\n',
    );
    expect(cardFiles('scene')).toContain('002-lighthouse-night.card');
    expect((await run('doctor', args(['doctor']))).message).not.toContain('인라인 summary');

    expect(
      readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8'),
    ).toContain('만조에만 열리는 문을 둘러싼 이야기.');

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { genre?: string } };
    expect(project.setting?.genre).toBeUndefined();
    expect(outcome.message).toContain("storyboard project set --genre '해양 미스터리'");

    expect(
      readFileSync(join(workspace, 'character', 'hana.card', 'memory', 'main.yaml'), 'utf8'),
    ).toContain('만조엔 문이 열려. 난 봤어.');
    expect(outcome.message).toContain('노트의 예시 대사를 말투 표본으로 두었습니다');
    expect(existsSync(join(workspace, '.storyboard', 'bible'))).toBe(false);
  });

  it('exports cards, scenes and the synopsis as a Markdown folder with ids and wiki links', async () => {
    await run('notes absorb', absorbArgs({ yes: true }), withFixedModel(container()));
    const target = join(workspace, '..', `${workspace.split('/').at(-1) ?? 'ws'}-export`);

    const outcome = await run('notes export', args(['notes', 'export'], {}, [target]));

    expect(outcome.ok).toBe(true);
    expect((outcome.data as { written: string[] }).written).toEqual(
      expect.arrayContaining(['인물/하나.md', '인물/준.md', '배경/항구.md', '씬/001-high-tide.md', '시놉시스.md']),
    );
    const hana = readFileSync(join(target, '인물', '하나.md'), 'utf8');
    expect(hana).toContain('storyboard-id: hana');
    expect(hana).toContain('# 하나');
    expect(hana).toContain('- [[준]]: 소꿉친구');
    const scene = readFileSync(join(target, '씬', '001-high-tide.md'), 'utf8');
    expect(scene).toContain('storyboard-type: scene');
    expect(scene).toContain('location: "[[항구]]"');
    expect(scene).toContain('- "[[하나]]"');
    expect(scene).toContain('만조의 밤, 하나가 항구에서 문이 열리는 것을 본다.');
    expect(readFileSync(join(target, '시놉시스.md'), 'utf8')).toContain('만조에만 열리는 문을 둘러싼 이야기.');
    rmSync(target, { recursive: true, force: true });
  });

  it('turns notes about an existing card into candidates that card promote applies', async () => {
    writeCardBundleFromYaml(
      workspace,
      'type: character\nid: hana\nname: 하나\nrole: main\nattributes:\n  age: 17\ndescription:\n  - 등대지기의 손녀.\n',
    );
    const before = readBundleText(workspace, 'character', 'hana');

    const absorbed = await run(
      'notes absorb',
      absorbArgs({ yes: true }),
      withFixedModel(container()),
    );

    expect(absorbed.message).toContain('기존 카드 hana 에 대한 내용은 후보로 남겼습니다');
    expect(readBundleText(workspace, 'character', 'hana')).toBe(before);

    const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
    expect(preview.message).toContain('노트에서  hana (하나) 변경');
    expect(readBundleText(workspace, 'character', 'hana')).toBe(before);

    const promoted = await run('card promote', args(['card', 'promote']));
    expect(promoted.ok).toBe(true);
    expect(promoted.message).toBe('카드 1개를 갱신했습니다.');

    const after = await readCardYaml(workspace, 'hana');
    expect(after).toContain("age: '19'");
    expect(after).toContain('달의 문 너머를 보고 싶다');
    expect(await readAbsorbPending(workspace, 'hana')).toEqual([]);

    const again = await run('card promote', args(['card', 'promote']));
    expect(again.message).toBe('승격할 후보가 없습니다.');
  });

  function withHanaFact(plan: NoteAbsorbPlan): NoteAbsorbPlan {
    return {
      ...plan,
      cards: plan.cards.map((entry) =>
        entry.card.id === 'hana'
          ? { ...entry, facts: [{ key: 'birth', value: '등대에서 태어났다' }] }
          : entry,
      ),
    };
  }

  it('writes the facts a note gives a new card as fact lines', async () => {
    await run('notes absorb', absorbArgs({ yes: true }), withFixedModel(container(), withHanaFact));

    const statements: string = readBundleText(workspace, 'character', 'hana');
    expect(statements).toContain('facet: fact');
    expect(statements).toContain('등대에서 태어났다');
  });

  it('leaves the facts a note gives an existing card pending', async () => {
    writeCardBundleFromYaml(workspace, 'type: character\nid: hana\nname: 하나\nrole: main\n');

    await run('notes absorb', absorbArgs({ yes: true }), withFixedModel(container(), withHanaFact));

    expect(readBundleText(workspace, 'character', 'hana')).not.toContain('등대에서 태어났다');
    expect(await readAbsorbPending(workspace, 'hana')).toContainEqual(
      expect.objectContaining({ facet: 'fact', key: 'birth', value: '등대에서 태어났다' }),
    );
  });

  describe('candidates left by earlier absorbs', () => {
    const otherLocation = join(vault, '인물');

    function writeExistingCard(id: string, name: string): void {
      writeCardBundleFromYaml(
        workspace,
        `type: character\nid: ${id}\nname: ${name}\nrole: main\nattributes:\n  age: 17\n`,
      );
    }

    function absorbAt(
      location: string,
      reshape?: (plan: NoteAbsorbPlan) => NoteAbsorbPlan,
      flags: Record<string, string | boolean> = {},
    ) {
      return run(
        'notes absorb',
        args(['notes', 'absorb'], { yes: true, ...flags }, [location]),
        withFixedModel(container(), reshape),
      );
    }

    function onlyCards(...ids: string[]) {
      return (plan: NoteAbsorbPlan): NoteAbsorbPlan => ({
        ...plan,
        cards: plan.cards.filter((entry) => ids.includes(entry.card.id)),
      });
    }

    function hanaAged(value: string) {
      return (plan: NoteAbsorbPlan): NoteAbsorbPlan => ({
        ...plan,
        cards: onlyCards('hana')(plan).cards.map((entry) => ({
          ...entry,
          changes: entry.changes.map((change) =>
            change.kind === 'attribute' && change.key === 'age' ? { ...change, value } : change,
          ),
        })),
      });
    }

    beforeEach(async () => {
      writeExistingCard('hana', '하나');
      await absorbAt(vault, onlyCards('hana', 'harbor'));
    });

    it('keeps the candidates of an earlier location when another is absorbed', async () => {
      const second = await absorbAt(otherLocation, hanaAged('20'));
      expect(second.message).toContain('기존 카드 hana 에 대한 내용은 후보로 남겼습니다.');
      expect(second.message).toContain('승격을 기다리는 카드 1장 (hana)');

      const sessions = new Set((await readAbsorbPending(workspace, 'hana')).map((line) => line.source.session));
      expect([...sessions].sort()).toEqual([vault, otherLocation].sort());
      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain('노트에서  hana (하나) 변경 2건');
    });
    it('replaces only what the same location left before', async () => {
      await absorbAt(vault, hanaAged('20'));

      const sessions = new Set((await readAbsorbPending(workspace, 'hana')).map((line) => line.source.session));
      expect([...sessions]).toEqual([vault]);
      await run('card promote', args(['card', 'promote']));
      expect(await readCardYaml(workspace, 'hana')).toContain("age: '20'");
    });
    it('does not drop pending candidates when an absorb leaves none of its own', async () => {
      const second = await absorbAt(otherLocation, onlyCards());

      expect(second.message).toContain('승격을 기다리는 카드 1장 (hana)');
      expect((await readAbsorbPending(workspace, 'hana')).length).toBeGreaterThan(0);
    });

    it('starts over with --replace-candidates', async () => {
      writeExistingCard('jun', '준');
      const second = await absorbAt(otherLocation, onlyCards('jun'), {
        'replace-candidates': true,
      });

      expect(second.message).toContain('승격을 기다리는 카드 1장 (jun)');
    });
    it('applies the location absorbed last when two notes disagree on a slot', async () => {
      await absorbAt(otherLocation, hanaAged('20'));

      const promoted = await run('card promote', args(['card', 'promote']));
      expect(promoted.message).toBe('카드 1개를 갱신했습니다.');
      const hana = await readCardYaml(workspace, 'hana');
      expect(hana).toContain("age: '20'");
      expect(hana).toContain('달의 문 너머를 보고 싶다');
    });

    it('refuses --change without exactly one card id', async () => {
      const outcome = await run(
        'card discard',
        args(['card', 'discard'], { change: 's1:attribute:age' }, ['hana']),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain('카드 단위로 버립니다');
    });

    it('discards the candidates of the named cards, or all of them', async () => {
      writeExistingCard('jun', '준');
      await absorbAt(otherLocation, onlyCards('jun'));

      const one = await run('card discard', args(['card', 'discard'], {}, ['jun']));
      expect(one.message).toBe('후보를 버렸습니다.\n  jun');

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain('노트에서  hana');

      const all = await run('card discard', args(['card', 'discard']));
      expect(all.message).toBe('후보를 버렸습니다.\n  hana');
      expect(await readAbsorbPending(workspace, 'hana')).toEqual([]);

      const none = await run('card discard', args(['card', 'discard']));
      expect(none.message).toBe('버릴 후보가 없습니다.');
    });
    it('keeps one synopsis candidate per location beside the author synopsis', async () => {
      const candidateLocations = async (): Promise<string[]> =>
        (await container().notes.listSynopsisCandidates(NodeUri.file(workspace))).map(
          (candidate) => candidate.location,
        );

      await absorbAt(vault);
      await absorbAt(otherLocation);
      await absorbAt(vault);
      expect((await candidateLocations()).sort()).toEqual([otherLocation, vault].sort());
      const [newest] = await container().notes.listSynopsisCandidates(NodeUri.file(workspace));
      expect(newest?.markdown).toContain('만조에만 열리는 문을 둘러싼 이야기.');

      await absorbAt(vault, undefined, { 'replace-candidates': true });
      expect(await candidateLocations()).toEqual([vault]);
    });

    it('writes the newest synopsis candidate on apply and forgets the rest', async () => {
      await absorbAt(vault);
      await absorbAt(otherLocation);
      const notes = container().notes;

      expect(await notes.applySynopsisCandidate(NodeUri.file(workspace))).toMatchObject({ ok: true });
      expect(readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8')).toContain(
        '만조에만 열리는 문을 둘러싼 이야기.',
      );
      expect(await notes.listSynopsisCandidates(NodeUri.file(workspace))).toEqual([]);
      expect(await notes.applySynopsisCandidate(NodeUri.file(workspace))).toMatchObject({
        ok: false,
        kind: 'none',
      });
    });

    it('discards the synopsis candidates without touching the synopsis', async () => {
      await absorbAt(vault);
      const before: string = readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8');

      expect(await container().notes.discardSynopsisCandidates(NodeUri.file(workspace))).toBe(1);
      expect(readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8')).toBe(before);
    });
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
