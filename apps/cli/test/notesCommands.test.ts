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
  parseScene,
  coerceNoteExtraction,
  type NoteAbsorbPlan,
} from '@storyboard/story-model';
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
      sampleLines: ['만조엔 문이 열려. 난 봤어.'],
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
    expect(scene).toContain('summary: 01-high-tide.summary.md');
    expect(readFileSync(join(workspace, 'scene', '01-high-tide.summary.md'), 'utf8')).toBe(
      '만조의 밤, 하나가 항구에서 문이 열리는 것을 본다.\n',
    );
    expect(cardFiles('scene')).toContain('02-lighthouse-night.card');
    expect((await run('doctor', args(['doctor']))).message).not.toContain('인라인 summary');

    expect(
      readFileSync(join(workspace, '.storyboard', 'outline', 'synopsis.md'), 'utf8'),
    ).toContain('만조에만 열리는 문을 둘러싼 이야기.');

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { genre?: string } };
    expect(project.setting?.genre).toBeUndefined();
    expect(outcome.message).toContain("storyboard project set --genre '해양 미스터리'");

    // #105-14: 노트의 예시 대사는 첫 씬의 말투 표본이 된다.
    expect(
      JSON.parse(readFileSync(join(workspace, '.storyboard', 'memory', 'voiceSeeds.json'), 'utf8')),
    ).toEqual({ characters: { hana: ['만조엔 문이 열려. 난 봤어.'] } });
    expect(outcome.message).toContain('노트의 예시 대사를 말투 표본으로 두었습니다');
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

  describe('candidates left by earlier absorbs', () => {
    const candidatesPath = () =>
      join(workspace, '.storyboard', 'cache', 'notes', 'candidates.json');
    const otherLocation = join(vault, '인물');

    function writeExistingCard(id: string, name: string): void {
      writeFileSync(
        join(workspace, 'character', `${id}.card`),
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
      // The first absorb makes harbor.card, so a later absorb has a second existing card to touch.
      await absorbAt(vault, onlyCards('hana', 'harbor'));
    });

    it('keeps the candidates of an earlier location when another is absorbed', async () => {
      const second = await absorbAt(otherLocation, onlyCards('harbor'));
      expect(second.message).toContain('기존 카드 harbor 에 대한 내용은 후보로 남겼습니다.');
      expect(second.message).toContain('승격을 기다리는 카드 2장 (hana, harbor)');

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain(`노트에서  hana (하나) 변경 3건 ← ${vault}`);
      expect(preview.message).not.toContain(`${vault}, `);
      expect(preview.message).not.toContain('보류');
    });

    it('merges what two locations say about one card', async () => {
      await absorbAt(otherLocation, onlyCards('hana'));

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain(
        `노트에서  hana (하나) 변경 3건 ← ${vault}, ${otherLocation}`,
      );
    });

    it('replaces only what the same location left before', async () => {
      await absorbAt(vault, hanaAged('20'));

      const file = JSON.parse(readFileSync(candidatesPath(), 'utf8')) as {
        sources: { location: string }[];
      };
      expect(file.sources.map((source) => source.location)).toEqual([vault]);

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).not.toContain('보류');
    });

    it('does not drop pending candidates when an absorb leaves none of its own', async () => {
      const second = await absorbAt(otherLocation, onlyCards());

      expect(second.message).toContain('승격을 기다리는 카드 1장 (hana)');
      expect(existsSync(candidatesPath())).toBe(true);
    });

    it('starts over with --replace-candidates', async () => {
      const second = await absorbAt(otherLocation, onlyCards('harbor'), {
        'replace-candidates': true,
      });

      expect(second.message).toContain('승격을 기다리는 카드 1장 (harbor)');
    });

    it('holds back a slot two notes disagree on and promotes the rest', async () => {
      await absorbAt(otherLocation, hanaAged('20'));

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain('보류      hana attribute:age');
      expect(preview.message).toContain(`[s1:attribute:age] 19 ← ${vault}`);
      expect(preview.message).toContain(`[s2:attribute:age] 20 ← ${otherLocation}`);

      const promoted = await run('card promote', args(['card', 'promote']));
      expect(promoted.message).toContain('카드 1개를 갱신했습니다.');
      expect(promoted.message).toContain('보류      hana attribute:age');

      const hana = readFileSync(join(workspace, 'character', 'hana.card'), 'utf8');
      expect(hana).toContain('age: 17');
      expect(hana).toContain('달의 문 너머를 보고 싶다');

      const again = await run('card promote', args(['card', 'promote']));
      expect(again.message).toContain('카드 0개를 갱신했습니다.');
      expect(again.message).toContain('[s2:attribute:age] 20');
    });

    it('keeps one value of a conflict with card discard --change, then promotes it', async () => {
      await absorbAt(otherLocation, hanaAged('20'));

      const missing = await run(
        'card discard',
        args(['card', 'discard'], { change: 's9:attribute:age' }, ['hana']),
      );
      expect(missing.ok).toBe(false);

      const discarded = await run(
        'card discard',
        args(['card', 'discard'], { change: 's1:attribute:age' }, ['hana']),
      );
      expect(discarded.ok).toBe(true);

      const promoted = await run('card promote', args(['card', 'promote']));
      expect(promoted.message).toBe('카드 1개를 갱신했습니다.');
      expect(readFileSync(join(workspace, 'character', 'hana.card'), 'utf8')).toContain(
        "age: '20'",
      );
    });

    it('refuses --change without exactly one card id', async () => {
      const outcome = await run(
        'card discard',
        args(['card', 'discard'], { change: 's1:attribute:age' }),
      );
      expect(outcome.ok).toBe(false);
    });

    it('discards the candidates of the named cards, or all of them', async () => {
      const draftCandidates = join(workspace, '.storyboard', 'cache', 'cards');
      mkdirSync(draftCandidates, { recursive: true });
      writeFileSync(
        join(draftCandidates, '01-high-tide.json'),
        JSON.stringify({
          sceneStem: '01-high-tide',
          generatedAt: new Date().toISOString(),
          characters: [{ cardId: 'hana', attributes: [{ key: 'height', value: '160' }] }],
        }),
      );
      await absorbAt(otherLocation, onlyCards('harbor'));

      const one = await run('card discard', args(['card', 'discard'], {}, ['harbor']));
      expect(one.message).toBe('후보를 버렸습니다.\n  노트에서  harbor');

      const preview = await run('card promote', args(['card', 'promote'], { 'dry-run': true }));
      expect(preview.message).toContain('노트에서  hana');
      expect(preview.message).toContain('초안에서  1건');

      const all = await run('card discard', args(['card', 'discard']));
      expect(all.message).toBe('후보를 버렸습니다.\n  노트에서  hana\n  초안에서  1건');
      expect(existsSync(candidatesPath())).toBe(false);

      const none = await run('card discard', args(['card', 'discard']));
      expect(none.message).toBe('버릴 후보가 없습니다.');
    });

    it('keeps one synopsis section per location beside the author synopsis', async () => {
      const synopsisCandidate = join(
        workspace,
        '.storyboard',
        'cache',
        'notes',
        'synopsis.candidate.md',
      );
      const sectionLocations = () =>
        [...readFileSync(synopsisCandidate, 'utf8').matchAll(/^<!-- note-source: (.+) -->$/gm)].map(
          (match) => match[1],
        );

      await absorbAt(vault);
      await absorbAt(otherLocation);
      await absorbAt(vault);
      expect(sectionLocations()).toEqual([otherLocation, vault]);
      expect(readFileSync(synopsisCandidate, 'utf8')).toContain(
        '만조에만 열리는 문을 둘러싼 이야기.',
      );

      await absorbAt(vault, undefined, { 'replace-candidates': true });
      expect(sectionLocations()).toEqual([vault]);
    });

    it('refuses a candidate file it cannot read before any request or write', async () => {
      writeFileSync(candidatesPath(), '{broken');

      const planned = await run('notes absorb', absorbArgs({ yes: true }));
      expect(planned.ok).toBe(false);
      expect(planned.message).toContain('.storyboard/cache/notes/candidates.json');
      expect(existsSync(join(workspace, '.storyboard', 'cache', 'notes', 'responses.json'))).toBe(
        false,
      );

      const applied = await absorbAt(vault, onlyCards('jun'));
      expect(applied.ok).toBe(false);
      expect(existsSync(join(workspace, 'character', 'jun.card'))).toBe(false);

      await expect(
        run('card promote', args(['card', 'promote'], { 'dry-run': true })),
      ).rejects.toThrow('.storyboard/cache/notes/candidates.json');
      expect(readFileSync(candidatesPath(), 'utf8')).toBe('{broken');
    });

    it('drops a candidate file an earlier version wrote, with a warning', async () => {
      const warnings: string[] = [];
      const warning = createCliContainer({
        workspacePath: workspace,
        logger: { ...silentLogger, warn: (message: string) => warnings.push(message) },
        canPrompt: false,
        version: '0.0.0',
      });
      mkdirSync(join(workspace, '.storyboard', 'cache', 'notes'), { recursive: true });
      writeFileSync(
        candidatesPath(),
        JSON.stringify({ location: '/old', absorbedAt: new Date().toISOString(), candidates: [] }),
      );

      const preview = await run(
        'card promote',
        args(['card', 'promote'], { 'dry-run': true }),
        warning,
      );
      expect(preview.message).toBe('승격할 후보가 없습니다.');
      expect(warnings.join('\n')).toContain('이전 버전이 남긴 노트 카드 후보는 읽지 않습니다');

      await run(
        'notes absorb',
        args(['notes', 'absorb'], { yes: true }, [vault]),
        withFixedModel(warning),
      );
      const file = JSON.parse(readFileSync(candidatesPath(), 'utf8')) as { version: number };
      expect(file.version).toBe(2);
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
