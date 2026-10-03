import { describe, expect, it } from 'vitest';

import { NoteExtractionPrompt } from '@storyboard/story-ai';
import {
  buildNoteAbsorbPlan,
  groupNotesIntoChunks,
  measureNoteAbsorbWorkload,
  noteChunkCharacterLimit,
  type NoteDocument,
  parseScene,
  type SceneFile,
  type StoryboardCard,
  coerceNoteExtraction,
  coerceNoteSynthesis,
  emptyNoteSynthesis,
  type NoteExtraction,
  type NoteExtractionEntity,
} from '@storyboard/story-model';

function note(id: string, body = '본문', origin: NoteDocument['origin'] = 'tree'): NoteDocument {
  return { id, title: id.replace(/\.md$/, ''), path: [], body, origin };
}

function entity(overrides: Partial<NoteExtractionEntity> & Pick<NoteExtractionEntity, 'name'>) {
  return coerceNoteExtraction({ entities: [{ type: 'character', ...overrides }] })
    .entities[0] as NoteExtractionEntity;
}

function extraction(overrides: Partial<NoteExtraction>): NoteExtraction {
  return { notes: [], entities: [], scenes: [], premise: [], ...overrides };
}

function existingScene(stem: string, title: string): SceneFile {
  return parseScene(`type: scene\nid: ${stem}\ntitle: ${title}\nsummary: 요약\n`, `${stem}.card`);
}

const hanaCard: StoryboardCard = {
  type: 'character',
  id: 'hana',
  name: '하나',
  role: 'main',
  attributes: { age: '17' },
  description: ['등대지기의 손녀.'],
};

describe('note extraction prompt', () => {
  it('shows every note with its id and lists the cards that already exist', () => {
    const prompt = NoteExtractionPrompt.build(
      [{ id: '인물/하나.md', title: '하나', path: ['인물'], body: '등대지기의 손녀.' }],
      [{ id: 'jun', type: 'character', name: '준', aliases: ['준이'] }],
    );

    expect(prompt.user).toContain('### 노트 id: 인물/하나.md');
    expect(prompt.user).toContain('위치: 인물');
    expect(prompt.user).toContain('- jun · 인물 · 준 (다른 호칭: 준이)');
  });

  it('keeps what parses when one entry of a response is malformed', () => {
    const parsed = coerceNoteExtraction({
      notes: [{ id: 'a.md', kinds: ['character', 'nonsense'] }, { kinds: ['scene'] }],
      entities: [
        { type: 'character', name: '하나', role: 'hero', weather: '', aliases: ['', '하나양'] },
        { type: 'vehicle', name: '배' },
      ],
      scenes: [{ title: '만조', summary: '문이 열린다.' }, { title: '빈 씬', summary: '' }],
      premise: ['해양 미스터리', ''],
    });

    expect(parsed.notes).toEqual([{ id: 'a.md', kinds: ['character'] }]);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]).toMatchObject({ name: '하나', aliases: ['하나양'] });
    expect(parsed.entities[0]?.role).toBeUndefined();
    expect(parsed.scenes.map((scene) => scene.title)).toEqual(['만조']);
    expect(parsed.premise).toEqual(['해양 미스터리']);
  });

  it('reads a synthesis with blank fields as nothing proposed', () => {
    expect(coerceNoteSynthesis(null)).toEqual(emptyNoteSynthesis);
    expect(
      coerceNoteSynthesis({ setting: { genre: '미스터리', pov: 'sideways', audience: '' } }),
    ).toEqual({ setting: { genre: '미스터리' }, synopsis: { mainConflicts: [], styleRules: [] } });
  });
});

describe('note chunks', () => {
  it('keeps notes in order and splits a note longer than one request', () => {
    const long = 'ㄱ'.repeat(noteChunkCharacterLimit + 10);
    const chunks = groupNotesIntoChunks([note('a.md'), note('b.md', long), note('c.md')]);

    expect(chunks.map((chunk) => chunk.map((entry) => entry.id))).toEqual([
      ['a.md'],
      ['b.md'],
      ['b.md', 'c.md'],
    ]);
  });

  it('counts one synthesis request on top of the extraction requests', () => {
    const workload = measureNoteAbsorbWorkload(
      [note('a.md', '가'.repeat(300)), note('b.md', '나'.repeat(300), 'link')],
      { extractionMaxTokens: 8000, synthesisMaxTokens: 2000 },
    );

    expect(workload).toMatchObject({
      noteCount: 2,
      linkedNoteCount: 1,
      requestCount: 2,
      outputTokenCeiling: 10000,
    });
    expect(workload.inputTokens).toBeGreaterThan(400);
  });
});

describe('buildNoteAbsorbPlan', () => {
  const baseInput = {
    synthesis: emptyNoteSynthesis,
    cards: [] as StoryboardCard[],
    scenes: [] as SceneFile[],
    scenePrefixDigits: 2,
  };

  it('makes one card of a person described in two notes and resolves relations by name', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('하나.md'), note('준.md'), note('컨셉.md')],
      extractions: [
        extraction({
          entities: [
            entity({
              name: '하나',
              suggestedId: 'hana',
              role: 'supporting',
              description: ['등대지기의 손녀.'],
              relations: [{ target: '준', type: '소꿉친구' }],
              sourceNotes: ['하나.md'],
            }),
            entity({ name: '준', suggestedId: '준', sourceNotes: ['준.md'] }),
          ],
        }),
        extraction({
          entities: [
            entity({
              name: '하나',
              role: 'main',
              desire: ['문 너머를 보고 싶다'],
              sourceNotes: ['컨셉.md'],
            }),
          ],
        }),
      ],
    });

    expect(plan.cards.map((card) => [card.card.id, card.isNew])).toEqual([
      ['hana', true],
      // 한글 이름은 id 가 될 수 없어, 쓸 수 없는 제안은 순번 id 로 떨어진다.
      ['character-2', true],
    ]);
    expect(plan.cards[0]?.card).toMatchObject({ role: 'main' });
    expect(plan.cards[0]?.sourceNotes).toEqual(['하나.md', '컨셉.md']);
    expect(plan.cards[0]?.changes.map((change) => change.kind)).toEqual([
      'descriptionLine',
      'desireLine',
      'relation',
    ]);
    expect(plan.cards[0]?.changes.find((change) => change.kind === 'relation')).toMatchObject({
      target: 'character-2',
    });
  });

  it('turns a note about an existing card into candidate changes only', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [hanaCard],
      notes: [note('하나.md')],
      extractions: [
        extraction({
          entities: [
            entity({
              name: '하나',
              suggestedId: 'hana-2',
              description: ['등대지기의 손녀.', '열아홉 살이 되었다.'],
              attributes: [{ key: 'age', value: '19' }],
              sourceNotes: ['하나.md'],
            }),
          ],
        }),
      ],
    });

    expect(plan.cards).toHaveLength(1);
    expect(plan.cards[0]).toMatchObject({ isNew: false, card: { id: 'hana' } });
    // 이미 카드에 있는 설명 줄은 다시 제안하지 않는다.
    expect(plan.cards[0]?.changes).toEqual([
      expect.objectContaining({ kind: 'descriptionLine', value: '열아홉 살이 되었다.' }),
      expect.objectContaining({ kind: 'attribute', key: 'age', value: '19' }),
    ]);
  });

  it('leaves out an existing card the notes add nothing to', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [hanaCard],
      notes: [note('하나.md')],
      extractions: [
        extraction({
          entities: [entity({ name: '하나', description: ['등대지기의 손녀.'] })],
        }),
      ],
    });

    expect(plan.cards).toEqual([]);
  });

  it('numbers scenes after the last one, in note order, and skips a title that exists', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [hanaCard],
      scenes: [existingScene('03-prologue', '프롤로그')],
      notes: [note('씬/1 만조.md'), note('씬/2 등대.md')],
      extractions: [
        extraction({
          scenes: coerceNoteExtraction({
            scenes: [
              { title: '등대의 밤', slug: 'prologue', summary: '기록을 찾는다.', sourceNote: '씬/2 등대.md' },
              { title: '프롤로그', summary: '이미 있는 씬.', sourceNote: '씬/1 만조.md' },
              {
                title: '만조',
                slug: '만조',
                summary: '문이 열린다.',
                characterNames: ['하나', '등대지기'],
                locationName: '항구',
                sourceNote: '씬/1 만조.md',
              },
            ],
          }).scenes,
        }),
      ],
    });

    expect(plan.scenes.map((scene) => scene.fileName)).toEqual([
      '04-scene.card',
      '05-prologue-2.card',
    ]);
    expect(plan.scenes[0]?.card).toMatchObject({
      id: '04-scene',
      title: '만조',
      characters: ['hana'],
      summary: '문이 열린다.',
    });
    expect(plan.scenes[0]?.card.location).toBeUndefined();
    expect(plan.skippedScenes.map((scene) => scene.label)).toEqual(['프롤로그']);
    expect(plan.warnings).toHaveLength(2);
  });

  it('reports the notes nothing was taken from', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('하나.md'), note('OST 목록.md'), note('잡생각.md')],
      extractions: [
        extraction({
          notes: [
            { id: '하나.md', kinds: ['character'] },
            { id: 'OST 목록.md', kinds: ['other'] },
          ],
        }),
      ],
    });

    expect(plan.unclassifiedNotes.map((entry) => entry.id)).toEqual(['OST 목록.md', '잡생각.md']);
  });

  it('proposes a synopsis only when the notes gave one something to say', () => {
    const withSynopsis = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [],
      extractions: [],
      synthesis: {
        setting: { genre: '해양 미스터리', pov: 'third-limited' },
        synopsis: { logline: '만조에만 열리는 문.', mainConflicts: [], styleRules: [] },
      },
    });

    expect(withSynopsis.setting).toEqual({ genre: '해양 미스터리', pov: 'third-limited' });
    expect(withSynopsis.synopsis).toMatchObject({
      logline: '만조에만 열리는 문.',
      pov: 'third-limited',
    });
    expect(buildNoteAbsorbPlan({ ...baseInput, notes: [], extractions: [] }).synopsis).toBeUndefined();
  });
});
