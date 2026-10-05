import { describe, expect, it } from 'vitest';

import { NoteCardConsolidationPrompt, NoteExtractionPrompt } from '@storyboard/story-ai';
import {
  PlanNoteAbsorbUseCase,
  type AiGateway,
  type INoteAbsorbRepository,
  type IStoryFeatureRepository,
  type IStoryboardLogger,
} from '@storyboard/story-engine';
import {
  applyNoteConsolidation,
  groupNoteConsolidationTargets,
  type NoteConsolidationTarget,
  buildNoteAbsorbPlan,
  type NoteAbsorbPlan,
  type NoteConsolidationResult,
  readNoteConsolidationResponse,
  selectNoteConsolidationTargets,
  groupNotesIntoChunks,
  listKnownNoteEntities,
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
  type NoteExtractionKnownCard,
  type NoteExtractionResponse,
  type NoteExtractionResult,
  type NoteBundle,
  NodeUri,
  parseJsonObject,
  readNoteExtractionResponse,
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

  it('asks for what a place is, not only how it feels', () => {
    const prompt = NoteExtractionPrompt.build([], []);

    expect(prompt.system).toContain('배경(background)에만 적는 것:');
    expect(prompt.system).toContain('description: 이곳이 어떤 곳인지');
    expect(prompt.system).toContain('[기존 카드]에 있는 장소의 한 부분이면 새 배경을 만들지 말고');
    expect(prompt.system).toContain('"type":"background","name":"","suggestedId":"","aliases":[],"description":[],"tags":[]');
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

  it('drops an alias that carries a parenthesis, which is a note about the name and not a name', () => {
    const parsed = coerceNoteExtraction({
      entities: [
        {
          type: 'character',
          name: '조만재',
          aliases: ['만재', '엘리트라 불리는 쪽은 아님(은하를 그렇게 부름)', '[별명] 궤변가', '철물점 아저씨'],
        },
      ],
    });

    expect(parsed.entities[0]?.aliases).toEqual(['만재', '철물점 아저씨']);
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

  it('counts the synthesis request and up to three consolidation requests per extraction request', () => {
    const workload = measureNoteAbsorbWorkload(
      [note('a.md', '가'.repeat(300)), note('b.md', '나'.repeat(300), 'link')],
      { extractionMaxTokens: 8000, synthesisMaxTokens: 2000, consolidationMaxTokens: 4000 },
    );

    expect(workload).toMatchObject({
      noteCount: 2,
      linkedNoteCount: 1,
      requestCount: 5,
      outputTokenCeiling: 22000,
    });
    expect(workload.inputTokens).toBeGreaterThan(400);

    const twoChunks = measureNoteAbsorbWorkload(
      [note('a.md', '가'.repeat(noteChunkCharacterLimit - 100)), note('b.md', '나'.repeat(noteChunkCharacterLimit - 100))],
      { extractionMaxTokens: 8000, synthesisMaxTokens: 2000, consolidationMaxTokens: 4000 },
    );
    expect(twoChunks).toMatchObject({ requestCount: 9, outputTokenCeiling: 42000 });
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

  it('does not let one wrong alias pull another person into a card', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('1.md'), note('2.md'), note('3.md'), note('4.md'), note('5.md')],
      extractions: [
        extraction({
          entities: [
            entity({ name: '조만재', suggestedId: 'jo-manjae', aliases: ['궤변가'], sourceNotes: ['1.md'] }),
            entity({ name: '정은하', suggestedId: 'jeong-eunha', aliases: ['엘리트', '갤럭시'], sourceNotes: ['1.md'] }),
          ],
        }),
        extraction({
          entities: [entity({ name: '조만재', aliases: ['엘리트'], sourceNotes: ['3.md'] })],
        }),
        extraction({
          entities: [
            entity({ name: '정은하', aliases: ['엘리트'], desire: ['이해받고 싶다'], sourceNotes: ['4.md'] }),
            entity({ name: '엘리트', description: ['16세'], sourceNotes: ['5.md'] }),
            entity({ name: '은하', aliases: ['갤럭시'], sourceNotes: ['5.md'] }),
            entity({
              name: '손수영',
              relations: [{ target: '정은하', type: '친구' }],
              sourceNotes: ['5.md'],
            }),
          ],
        }),
      ],
    });
    const cardOf = (id: string) => plan.cards.find((card) => card.card.id === id);
    const valuesOf = (id: string) =>
      cardOf(id)?.changes.map((change) => ('value' in change ? change.value : change.kind));

    expect(valuesOf('jo-manjae')).toEqual(['궤변가', '엘리트']);
    expect(valuesOf('jeong-eunha')).toEqual(['엘리트', '갤럭시', '이해받고 싶다']);
    // 두 사람에 붙은 별칭만으로는 누구인지 알 수 없어 따로 남는다.
    expect(plan.cards.find((card) => card.card.name === '엘리트')?.isNew).toBe(true);
    // 이름이 아니라 별칭끼리만 겹치면 같은 사람이라 볼 근거가 없어 따로 남는다.
    expect(plan.cards.find((card) => card.card.name === '은하')?.isNew).toBe(true);
    expect(
      plan.cards
        .find((card) => card.card.name === '손수영')
        ?.changes.find((change) => change.kind === 'relation'),
    ).toMatchObject({ target: 'jeong-eunha' });
  });

  it('keeps two people apart when the model gives both the same alias in one request', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('a.md')],
      extractions: [
        extraction({
          entities: [
            entity({
              name: '조만재',
              suggestedId: 'jo-manjae',
              aliases: ['만재', '은하'],
              traits: ['무뚝뚝하다'],
              sourceNotes: ['a.md'],
            }),
            entity({
              name: '정은하',
              suggestedId: 'jeong-eunha',
              aliases: ['은하'],
              traits: ['허세를 부린다'],
              description: ['이사 온 화가'],
              sourceNotes: ['a.md'],
            }),
          ],
        }),
      ],
    });
    const valuesOf = (id: string) =>
      plan.cards
        .find((card) => card.card.id === id)
        ?.changes.map((change) => ('value' in change ? change.value : change.kind));

    expect(plan.cards.map((card) => card.card.id)).toEqual(['jo-manjae', 'jeong-eunha']);
    expect(valuesOf('jo-manjae')).toEqual(['만재', '은하', '무뚝뚝하다']);
    expect(valuesOf('jeong-eunha')).toEqual(['은하', '이사 온 화가', '허세를 부린다']);
  });

  it('keeps a later person out of a card that only took their alias in an earlier request', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('a.md'), note('b.md')],
      extractions: [
        extraction({
          entities: [
            entity({
              name: '조만재',
              suggestedId: 'jo-manjae',
              aliases: ['만재', '은하'],
              description: ['동네 철물점 주인'],
              sourceNotes: ['a.md'],
            }),
          ],
        }),
        extraction({
          entities: [
            entity({ name: '정은하', aliases: ['은하'], description: ['은하는 화가다'], sourceNotes: ['b.md'] }),
          ],
        }),
      ],
    });
    const valuesOf = (name: string) =>
      plan.cards
        .find((card) => card.card.name === name)
        ?.changes.map((change) => ('value' in change ? change.value : change.kind));

    expect(plan.cards.map((card) => [card.card.name, card.sourceNotes])).toEqual([
      ['조만재', ['a.md']],
      ['정은하', ['b.md']],
    ]);
    expect(valuesOf('조만재')).toEqual(['만재', '은하', '동네 철물점 주인']);
    expect(valuesOf('정은하')).toEqual(['은하', '은하는 화가다']);
  });

  it('merges a name into the one entry that carries it as an alias unless the name has its own id', () => {
    const planFor = (manjae: Partial<NoteExtractionEntity>) =>
      buildNoteAbsorbPlan({
        ...baseInput,
        notes: [note('a.md'), note('b.md')],
        extractions: [
          extraction({ entities: [entity({ name: '만재', ...manjae, sourceNotes: ['a.md'] })] }),
          extraction({
            entities: [entity({ name: '조만재', suggestedId: 'jo-manjae', aliases: ['만재'], sourceNotes: ['b.md'] })],
          }),
        ],
      }).cards.map((card) => [card.card.name, card.sourceNotes]);

    expect(planFor({})).toEqual([['만재', ['a.md', 'b.md']]]);
    expect(planFor({ suggestedId: 'manjae' })).toEqual([
      ['만재', ['a.md']],
      ['조만재', ['b.md']],
    ]);
  });

  it('makes one card of a place two requests name differently but give the same id', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('a.md'), note('b.md'), note('c.md')],
      extractions: [
        extraction({
          entities: [entity({ type: 'background', name: '만재네 집', suggestedId: 'manjae-house', sourceNotes: ['a.md'] })],
        }),
        extraction({
          entities: [entity({ type: 'background', name: '만재의 집', suggestedId: 'manjae-house', sourceNotes: ['b.md'] })],
        }),
        extraction({
          entities: [
            entity({
              type: 'background',
              name: '조만재의 집 거실',
              existingId: 'manjae-house',
              description: ['소파가 있는 거실'],
              sourceNotes: ['c.md'],
            }),
          ],
        }),
      ],
    });

    expect(plan.cards.map((card) => card.card.id)).toEqual(['manjae-house']);
    expect(plan.cards[0]?.sourceNotes).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('lists what earlier requests found beside the cards on disk', () => {
    const known = listKnownNoteEntities(
      [
        extraction({
          entities: [
            entity({ name: '하나', existingId: 'hana', sourceNotes: ['a.md'] }),
            entity({ name: '준', suggestedId: 'jun', aliases: ['준이'], sourceNotes: ['a.md'] }),
            entity({ type: 'background', name: 'Ayala Mall', sourceNotes: ['a.md'] }),
            entity({ name: '등대지기', suggestedId: 'hana', sourceNotes: ['a.md'] }),
          ],
        }),
        extraction({ entities: [entity({ name: '준', aliases: ['준돌이'], sourceNotes: ['b.md'] })] }),
      ],
      [{ id: 'hana', type: 'character', name: '하나', aliases: [] }],
    );

    expect(known).toEqual([
      { id: 'hana', type: 'character', name: '하나', aliases: [] },
      { id: 'jun', type: 'character', name: '준', aliases: ['준이', '준돌이'] },
      { id: 'ayala-mall', type: 'background', name: 'Ayala Mall', aliases: [] },
    ]);
  });

  it('keeps one of the items two notes word only differently in spacing or punctuation', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('a.md'), note('b.md')],
      extractions: [
        extraction({
          entities: [entity({ name: '조만재', traits: ['허세가 심함'], tags: ['허세'], sourceNotes: ['a.md'] })],
        }),
        extraction({
          entities: [
            entity({
              name: '조만재',
              traits: ['허세가  심함.', '고집이 세다'],
              tags: ['허세', '허세남'],
              sourceNotes: ['b.md'],
            }),
          ],
        }),
      ],
    });

    const changes = plan.cards[0]?.changes ?? [];
    expect(changes.filter((change) => change.kind === 'trait').map((change) => change.value)).toEqual([
      '허세가 심함',
      '고집이 세다',
    ]);
    expect(changes.filter((change) => change.kind === 'tag').map((change) => change.value)).toEqual([
      '허세',
      '허세남',
    ]);
  });

  it('does not propose a line an existing card says with other punctuation', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [hanaCard],
      notes: [note('하나.md')],
      extractions: [
        extraction({
          entities: [entity({ name: '하나', description: ['등대지기의 손녀'], sourceNotes: ['하나.md'] })],
        }),
      ],
    });

    expect(plan.cards).toEqual([]);
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
      notes: [note('씬/1 만조.md'), note('씬/2 등대.md'), note('씬/3 프롤로그.md')],
      extractions: [
        extraction({
          scenes: coerceNoteExtraction({
            scenes: [
              { title: '등대의 밤', slug: 'prologue', summary: '기록을 찾는다.', sourceNote: '씬/2 등대.md' },
              { title: '프롤로그', summary: '이미 있는 씬.', sourceNote: '씬/3 프롤로그.md' },
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

  it('makes one scene of a note, its other parts beats, and none of a draft', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      notes: [note('에피소드/01.md'), note('초안/01.md')],
      extractions: [
        extraction({
          notes: [
            { id: '에피소드/01.md', kinds: ['scene'] },
            { id: '초안/01.md', kinds: ['draft', 'character'] },
          ],
          scenes: coerceNoteExtraction({
            scenes: [
              {
                title: '첫 만남',
                slug: 'first-meeting',
                summary: '둘이 처음 만난다.',
                beats: ['공항에서 마주친다', '짐이 바뀐다'],
                sourceNote: '에피소드/01.md',
              },
              { title: '초안의 장면', summary: '원고 속 사건.', sourceNote: '초안/01.md' },
            ],
          }).scenes,
        }),
        // 한 노트가 두 요청에 나뉘어 읽히면 같은 출처의 씬이 다음 요청에서 또 온다.
        extraction({
          scenes: coerceNoteExtraction({
            scenes: [{ title: '집으로', summary: '함께 집으로 간다.', sourceNote: '에피소드/01.md' }],
          }).scenes,
        }),
      ],
    });

    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]?.card).toMatchObject({
      title: '첫 만남',
      summary: '둘이 처음 만난다.',
      beats: ['공항에서 마주친다', '짐이 바뀐다', '함께 집으로 간다.'],
    });
    expect(plan.draftNotes).toEqual([{ id: '초안/01.md', title: '초안/01' }]);
    expect(plan.unclassifiedNotes).toEqual([]);
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

describe('readNoteExtractionResponse', () => {
  const extractionText = '{"notes":[{"id":"a.md","kinds":["scene"]}],"scenes":[]}';

  it('reads a whole response', () => {
    const result = readNoteExtractionResponse(extractionText, parseJsonObject(extractionText), false);

    expect(result.failure).toBeUndefined();
    expect(result.extraction.notes).toEqual([{ id: 'a.md', kinds: ['scene'] }]);
  });

  it('reads nothing from a response cut at the output limit', () => {
    const cut = '{"notes":[{"id":"a.md","kinds":["scene"]}],"scenes":[{"title":"만';
    const result = readNoteExtractionResponse(cut, parseJsonObject(cut), true);

    expect(result.failure).toBe('truncated');
    expect(result.extraction).toEqual(extraction({}));
    expect(result.responseText).toBe(cut);
  });

  it('counts a broken response as unparsed even when an inner object parses', () => {
    // 따옴표 하나가 이스케이프되지 않으면 바깥 객체는 깨지고, 안쪽 notes 항목만 균형이 맞는다.
    const broken = '{"notes":[{"id":"a.md","kinds":["scene"]}],"scenes":[{"summary":"그가 "안녕" 했다"}]}';
    const parsed = parseJsonObject(broken);

    expect(parsed).not.toBeNull();
    expect(readNoteExtractionResponse(broken, parsed, false).failure).toBe('unparsed');
    expect(readNoteExtractionResponse('설명만 있음', null, false).failure).toBe('unparsed');
  });
});

describe('note card consolidation', () => {
  const baseInput = {
    synthesis: emptyNoteSynthesis,
    scenes: [] as SceneFile[],
    scenePrefixDigits: 2,
  };
  const chunkByNoteId = new Map([
    ['a.md', 0],
    ['b.md', 1],
  ]);

  function planOf(cards: StoryboardCard[], ...readings: Partial<NoteExtractionEntity>[][]) {
    return buildNoteAbsorbPlan({
      ...baseInput,
      cards,
      notes: [note('a.md'), note('b.md')],
      extractions: readings.map((entities) =>
        extraction({ entities: entities.map((overrides) => entity({ name: '조만재', ...overrides })) }),
      ),
    });
  }

  function valuesOf(plan: NoteAbsorbPlan, cardId: string) {
    return plan.cards
      .find((card) => card.card.id === cardId)
      ?.changes.map((change) => ('value' in change ? change.value : change.kind));
  }

  const twoReadings = planOf(
    [],
    [{ suggestedId: 'jo-manjae', traits: ['허세가 심함', '백과사전을 즐겨 읽음'], sourceNotes: ['a.md'] }],
    [{ traits: ['허세를 부린다', '백과사전을 탐독함'], tags: ['허세남'], sourceNotes: ['b.md'] }],
  );

  it('asks only about a card read in more than one request or already holding a list', () => {
    expect(selectNoteConsolidationTargets(twoReadings, chunkByNoteId, [])).toEqual([
      {
        cardId: 'jo-manjae',
        name: '조만재',
        type: 'character',
        existing: {},
        candidates: {
          traits: ['허세가 심함', '백과사전을 즐겨 읽음', '허세를 부린다', '백과사전을 탐독함'],
          tags: ['허세남'],
        },
        sharedAliases: [],
      },
    ]);

    const oneReading = planOf([], [{ traits: ['허세가 심함', '고집이 세다'], sourceNotes: ['a.md', 'a.md'] }]);
    expect(selectNoteConsolidationTargets(oneReading, chunkByNoteId, [])).toEqual([]);

    const existing: StoryboardCard = { type: 'character', id: 'jo', name: '조만재', role: 'main', traits: ['허세가 심함'] };
    const onCard = planOf([existing], [{ traits: ['허세를 부린다'], sourceNotes: ['a.md'] }]);
    expect(selectNoteConsolidationTargets(onCard, chunkByNoteId, [existing])).toMatchObject([
      { cardId: 'jo', existing: { traits: ['허세가 심함'] }, candidates: { traits: ['허세를 부린다'] } },
    ]);
  });

  it('asks about the description, voice and desire of a person and the lists of a place', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [],
      notes: [note('a.md'), note('b.md')],
      extractions: [
        extraction({
          entities: [
            entity({
              name: '조만재',
              suggestedId: 'jo-manjae',
              description: ['백과사전을 즐겨 읽는 집돌이'],
              voice: ['허세 섞인 말투'],
              desire: ['은하에게 인정받고 싶어함'],
              sourceNotes: ['a.md'],
            }),
            entity({ type: 'background', name: '만재네 집', suggestedId: 'manjae-house', description: ['낡은 아파트'], senses: ['녹슨 냄새'], sourceNotes: ['a.md'] }),
          ],
        }),
        extraction({
          entities: [
            entity({
              name: '조만재',
              description: ['아침마다 백과사전을 읽는 습관이 있음'],
              voice: ['허세스럽고 과장된 말투'],
              desire: ['은하와 가까워지고 싶어함'],
              sourceNotes: ['b.md'],
            }),
            entity({ type: 'background', name: '만재네 집', description: ['오래된 아파트'], tags: ['주거'], sourceNotes: ['b.md'] }),
          ],
        }),
      ],
    });

    expect(selectNoteConsolidationTargets(plan, chunkByNoteId, []).map((target) => [target.cardId, target.candidates])).toEqual([
      [
        'jo-manjae',
        {
          description: ['백과사전을 즐겨 읽는 집돌이', '아침마다 백과사전을 읽는 습관이 있음'],
          voice: ['허세 섞인 말투', '허세스럽고 과장된 말투'],
          desire: ['은하에게 인정받고 싶어함', '은하와 가까워지고 싶어함'],
        },
      ],
      ['manjae-house', { description: ['낡은 아파트', '오래된 아파트'], senses: ['녹슨 냄새'], tags: ['주거'] }],
    ]);
  });

  it('asks about an alias another card carries even when each card was read once', () => {
    const disk: StoryboardCard = { type: 'character', id: 'geunuk', name: '이근욱', role: 'extra', aliases: ['엘리트'] };
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [disk],
      notes: [note('a.md')],
      extractions: [
        extraction({
          entities: [
            entity({ name: '조만재', suggestedId: 'jo-manjae', aliases: ['만재', '엘리트'], sourceNotes: ['a.md'] }),
            entity({ name: '정은하', suggestedId: 'jeong-eunha', aliases: ['엘리트', '은하를 그렇게 부름'], sourceNotes: ['a.md'] }),
            entity({ name: '손수영', suggestedId: 'son-suyeong', aliases: ['수영'], sourceNotes: ['a.md'] }),
          ],
        }),
      ],
    });

    const targets = selectNoteConsolidationTargets(plan, chunkByNoteId, [disk]);

    expect(targets.map((target) => [target.cardId, target.sharedAliases])).toEqual([
      [
        'jo-manjae',
        [{ alias: '엘리트', readCount: 1, otherCards: [{ cardId: 'geunuk', name: '이근욱' }, { cardId: 'jeong-eunha', name: '정은하', readCount: 1 }] }],
      ],
      [
        'jeong-eunha',
        [{ alias: '엘리트', readCount: 1, otherCards: [{ cardId: 'geunuk', name: '이근욱' }, { cardId: 'jo-manjae', name: '조만재', readCount: 1 }] }],
      ],
    ]);
  });

  it('counts how many readings gave a shared alias to each card', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [],
      notes: [note('a.md'), note('b.md'), note('c.md')],
      extractions: [
        extraction({
          entities: [
            entity({ name: '조만재', suggestedId: 'jo-manjae', aliases: ['엘리트'], sourceNotes: ['a.md'] }),
            entity({ name: '정은하', suggestedId: 'jeong-eunha', aliases: ['엘리트'], sourceNotes: ['a.md'] }),
          ],
        }),
        extraction({ entities: [entity({ name: '정은하', aliases: ['엘리트!'], sourceNotes: ['b.md'] })] }),
        extraction({ entities: [entity({ name: '정은하', aliases: ['엘리트', '갤럭시'], sourceNotes: ['c.md'] })] }),
      ],
    });

    expect(
      selectNoteConsolidationTargets(plan, chunkByNoteId, []).map((target) => [target.cardId, target.sharedAliases]),
    ).toEqual([
      ['jo-manjae', [{ alias: '엘리트', readCount: 1, otherCards: [{ cardId: 'jeong-eunha', name: '정은하', readCount: 3 }] }]],
      ['jeong-eunha', [{ alias: '엘리트', readCount: 3, otherCards: [{ cardId: 'jo-manjae', name: '조만재', readCount: 1 }] }]],
    ]);
  });

  describe('a shared alias', () => {
    const plan = buildNoteAbsorbPlan({
      ...baseInput,
      cards: [],
      notes: [note('a.md')],
      extractions: [
        extraction({
          entities: [
            entity({ name: '조만재', suggestedId: 'jo-manjae', aliases: ['만재', '엘리트'], sourceNotes: ['a.md'] }),
            entity({ name: '정은하', suggestedId: 'jeong-eunha', aliases: ['은하', '엘리트'], sourceNotes: ['a.md'] }),
          ],
        }),
      ],
    });
    const targets = selectNoteConsolidationTargets(plan, chunkByNoteId, []);

    it('stays only on the card the model gives it to', () => {
      const result = applyNoteConsolidation(plan, targets, [
        { cardId: 'jo-manjae', values: { aliases: ['만재'] } },
        { cardId: 'jeong-eunha', values: { aliases: ['은하', '엘리트'] } },
      ]);

      expect(valuesOf(result.plan, 'jo-manjae')).toEqual(['만재']);
      expect(valuesOf(result.plan, 'jeong-eunha')).toEqual(['은하', '엘리트']);
      expect(result.warnings).toEqual([]);
    });

    it('leaves every card the model says it belongs to none of', () => {
      const result = applyNoteConsolidation(plan, targets, [
        { cardId: 'jo-manjae', values: { aliases: ['만재'] } },
        { cardId: 'jeong-eunha', values: { aliases: ['은하'] } },
      ]);

      expect(valuesOf(result.plan, 'jo-manjae')).toEqual(['만재']);
      expect(valuesOf(result.plan, 'jeong-eunha')).toEqual(['은하']);
      expect(result.warnings).toEqual([]);
    });

    it('stays on both cards with a warning when the answer gives it to both or is missing', () => {
      const toBoth = applyNoteConsolidation(plan, targets, [
        { cardId: 'jo-manjae', values: { aliases: ['만재', '엘리트'] } },
        { cardId: 'jeong-eunha', values: { aliases: ['은하', '엘리트'] } },
      ]);
      const halfAnswered = applyNoteConsolidation(plan, targets, [
        { cardId: 'jo-manjae', values: { aliases: ['만재'] } },
      ]);
      const warning = '별칭 «엘리트» 이 누구의 것인지 정하지 못해 조만재, 정은하 에 모두 남겼습니다.';

      for (const result of [toBoth, halfAnswered]) {
        expect(valuesOf(result.plan, 'jo-manjae')).toEqual(['만재', '엘리트']);
        expect(valuesOf(result.plan, 'jeong-eunha')).toEqual(['은하', '엘리트']);
        expect(result.warnings).toEqual([warning]);
      }
    });
  });

  it('keeps an alias a card on disk also has on the new card the model gives it to, and says so', () => {
    const disk: StoryboardCard = { type: 'character', id: 'geunuk', name: '이근욱', role: 'extra', aliases: ['엘리트'] };
    const plan = planOf([disk], [{ suggestedId: 'jo-manjae', aliases: ['만재', '엘리트'], sourceNotes: ['a.md'] }]);
    const targets = selectNoteConsolidationTargets(plan, chunkByNoteId, [disk]);

    const kept = applyNoteConsolidation(plan, targets, [{ cardId: 'jo-manjae', values: { aliases: ['만재', '엘리트'] } }]);
    expect(valuesOf(kept.plan, 'jo-manjae')).toEqual(['만재', '엘리트']);
    expect(kept.plan.cards.map((card) => card.card.id)).toEqual(['jo-manjae']);
    expect(kept.warnings).toEqual([
      '별칭 «엘리트» 은 조만재 의 것으로 보아 남겼습니다. 같은 별칭이 있는 기존 카드 이근욱 는 고치지 않았습니다.',
    ]);

    const dropped = applyNoteConsolidation(plan, targets, [{ cardId: 'jo-manjae', values: { aliases: ['만재'] } }]);
    expect(valuesOf(dropped.plan, 'jo-manjae')).toEqual(['만재']);
    expect(dropped.warnings).toEqual([]);
  });

  it('keeps only the candidates the model chose, never a wording it made up', () => {
    const targets = selectNoteConsolidationTargets(twoReadings, chunkByNoteId, []);
    const { plan } = applyNoteConsolidation(twoReadings, targets, [
      { cardId: 'jo-manjae', values: { traits: ['허세가 심함', '백과사전을 즐겨 읽음', '허풍쟁이'], tags: ['허세남'] } },
    ]);

    expect(valuesOf(plan, 'jo-manjae')).toEqual(['허세남', '허세가 심함', '백과사전을 즐겨 읽음']);
  });

  it('keeps a list of a new card the answer empties or leaves out, and drops an existing card it empties', () => {
    const targets = selectNoteConsolidationTargets(twoReadings, chunkByNoteId, []);
    expect(
      applyNoteConsolidation(twoReadings, targets, [{ cardId: 'jo-manjae', values: { traits: [], tags: [] } }]).plan,
    ).toEqual(twoReadings);
    expect(applyNoteConsolidation(twoReadings, targets, [{ cardId: 'jo-manjae', values: {} }]).plan).toEqual(twoReadings);

    const existing: StoryboardCard = { type: 'character', id: 'jo', name: '조만재', role: 'main', traits: ['허세가 심함'] };
    const onCard = planOf([existing], [{ traits: ['허세를 부린다'], sourceNotes: ['a.md'] }]);
    const onCardTargets = selectNoteConsolidationTargets(onCard, chunkByNoteId, [existing]);
    expect(
      applyNoteConsolidation(onCard, onCardTargets, [{ cardId: 'jo', values: { traits: [] } }]).plan.cards,
    ).toEqual([]);
  });

  it('lets the answer drop every alias of a new card', () => {
    const plan = planOf([], [{ suggestedId: 'jo-manjae', aliases: ['엘리트라 불리는 쪽은 아님'], traits: ['허세'], sourceNotes: ['a.md'] }]);
    const targets = selectNoteConsolidationTargets(plan, chunkByNoteId, []);

    expect(targets.map((target) => target.cardId)).toEqual(['jo-manjae']);
    expect(
      valuesOf(applyNoteConsolidation(plan, targets, [{ cardId: 'jo-manjae', values: { aliases: [], traits: ['허세'] } }]).plan, 'jo-manjae'),
    ).toEqual(['허세']);
  });

  it('leaves a card the answer left out as it was', () => {
    const targets = selectNoteConsolidationTargets(twoReadings, chunkByNoteId, []);

    expect(applyNoteConsolidation(twoReadings, targets, []).plan).toEqual(twoReadings);
  });

  it('sends each card in its own request unless it shares an alias with another', () => {
    const lines = (prefix: string) => [prefix.repeat(2_500)];
    const target = (cardId: string, description: string[], sharedWith: string[] = []): NoteConsolidationTarget => ({
      cardId,
      name: cardId,
      type: 'character',
      existing: {},
      candidates: { description },
      sharedAliases:
        sharedWith.length === 0 ? [] : [{ alias: '엘리트', readCount: 1, otherCards: sharedWith.map((id) => ({ cardId: id, name: id })) }],
    });
    const targets = [
      target('a', lines('가'), ['c']),
      target('b', lines('나')),
      target('c', lines('다'), ['a']),
      target('d', lines('라')),
      target('e', ['짧은 줄']),
    ];

    expect(groupNoteConsolidationTargets(targets).map((group) => group.map((item) => item.cardId))).toEqual([
      ['a', 'c'],
      ['b'],
      ['d'],
      ['e'],
    ]);
  });

  it('keeps the first item of each group and every candidate the groups left out', () => {
    const targets = selectNoteConsolidationTargets(twoReadings, chunkByNoteId, []);
    const answer = readNoteConsolidationResponse(
      {
        cards: [
          {
            id: 'jo-manjae',
            traits: [['허세가 심함', '허세를 부린다'], ['백과사전을 즐겨 읽음', '백과사전을 탐독함', '지어낸 말']],
            tags: ['허세남'],
          },
        ],
      },
      false,
    );
    const nothingGrouped = readNoteConsolidationResponse({ cards: [{ id: 'jo-manjae', traits: [['허세가 심함']] }] }, false);

    expect(answer.consolidated[0]).toEqual({
      cardId: 'jo-manjae',
      values: { traits: ['허세가 심함', '백과사전을 즐겨 읽음'], tags: ['허세남'] },
      placed: { traits: ['허세가 심함', '허세를 부린다', '백과사전을 즐겨 읽음', '백과사전을 탐독함', '지어낸 말'] },
    });
    expect(valuesOf(applyNoteConsolidation(twoReadings, targets, answer.consolidated).plan, 'jo-manjae')).toEqual([
      '허세남',
      '허세가 심함',
      '백과사전을 즐겨 읽음',
    ]);
    expect(valuesOf(applyNoteConsolidation(twoReadings, targets, nothingGrouped.consolidated).plan, 'jo-manjae')).toEqual([
      '허세남',
      '허세가 심함',
      '백과사전을 즐겨 읽음',
      '허세를 부린다',
      '백과사전을 탐독함',
    ]);
  });

  it('reads a response and refuses a cut or shapeless one', () => {
    expect(
      readNoteConsolidationResponse({ cards: [{ id: 'jo', traits: ['허세가 심함', ''], voice: 'x' }, { traits: [] }] }, false),
    ).toEqual({ consolidated: [{ cardId: 'jo', values: { traits: ['허세가 심함'] } }] });
    expect(readNoteConsolidationResponse({ cards: [] }, true).failure).toBe('truncated');
    expect(readNoteConsolidationResponse({ characters: [] }, false).failure).toBe('unparsed');
    expect(readNoteConsolidationResponse(null, false).failure).toBe('unparsed');
  });

  it('shows each card with what it has, what the notes offer and whom it shares an alias with', () => {
    const prompt = NoteCardConsolidationPrompt.build([
      {
        cardId: 'jo',
        name: '조만재',
        type: 'character',
        existing: { traits: ['허세가 심함'] },
        candidates: { aliases: ['엘리트'], traits: ['허세를 부린다'] },
        sharedAliases: [
          {
            alias: '엘리트',
            readCount: 1,
            otherCards: [
              { cardId: 'eunha', name: '정은하', readCount: 4 },
              { cardId: 'geunuk', name: '이근욱' },
            ],
          },
        ],
      },
    ]);

    expect(prompt.user).toBe(
      [
        '[인물] id: jo (조만재)',
        '[기존] traits:',
        '- 허세가 심함',
        '[후보] aliases:',
        '- 엘리트',
        '[후보] traits:',
        '- 허세를 부린다',
        '[공유 별칭] 엘리트 — 이 카드에서 1번 읽힘 · eunha (정은하) 4번 읽힘 · geunuk (이근욱) 기존 카드',
      ].join('\n'),
    );
  });
});

describe('PlanNoteAbsorbUseCase', () => {
  const workspaceRoot = NodeUri.file('/tmp/storyboard-plan-test');
  const longBody = '가'.repeat(noteChunkCharacterLimit - 100);
  const bundle: NoteBundle = {
    kind: 'obsidian',
    location: '/vault',
    collectedAt: '2026-10-04T00:00:00.000Z',
    notes: [note('첫째.md', longBody), note('둘째.md', longBody)],
    skipped: [],
  };

  function createUseCase(
    results: readonly NoteExtractionResult[],
    consolidation: NoteConsolidationResult | readonly NoteConsolidationResult[] = { consolidated: [] },
  ) {
    const savedResponses: NoteExtractionResponse[][] = [];
    const warnings: string[] = [];
    const consolidationRequests: unknown[] = [];
    const knownCardRequests: NoteExtractionKnownCard[][] = [];
    let call = 0;
    const aiService = {
      extractNotes: async (_chunk: unknown, knownCards: NoteExtractionKnownCard[]) => {
        knownCardRequests.push(knownCards);
        return results[call++] as NoteExtractionResult;
      },
      synthesizeNotePremise: async () => emptyNoteSynthesis,
      consolidateNoteCards: async (targets: unknown) => {
        consolidationRequests.push(targets);
        return Array.isArray(consolidation)
          ? (consolidation[consolidationRequests.length - 1] as NoteConsolidationResult)
          : (consolidation as NoteConsolidationResult);
      },
    };
    const useCase = new PlanNoteAbsorbUseCase({
      aiGateway: { createService: () => aiService } as unknown as AiGateway,
      logger: {
        info: () => undefined,
        warn: (message: string) => warnings.push(message),
        error: () => undefined,
      } as unknown as IStoryboardLogger,
      storyRepository: {
        load: async () => ({ cards: [], scenes: [], project: { editor: { scenePrefixDigits: 2 } } }),
      } as unknown as IStoryFeatureRepository,
      noteRepository: {
        savePlan: async () => undefined,
        saveExtractionResponses: async (_root: unknown, responses: NoteExtractionResponse[]) => {
          savedResponses.push(responses);
        },
      } as unknown as INoteAbsorbRepository,
    });

    return { useCase, savedResponses, warnings, consolidationRequests, knownCardRequests };
  }

  const readable: NoteExtractionResult = {
    extraction: extraction({ notes: [{ id: '둘째.md', kinds: ['scene'] }] }),
    responseText: '{"notes":[]}',
  };
  const truncated: NoteExtractionResult = {
    extraction: extraction({}),
    responseText: '{"notes":[',
    failure: 'truncated',
  };

  it('warns about a request it could not read and keeps every response in the cache', async () => {
    const { useCase, savedResponses, warnings } = createUseCase([truncated, readable]);

    const result = await useCase.execute({ workspaceRoot, bundle });

    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.warnings[0]).toContain('노트 묶음 1/2 (첫째)은 응답이 출력 한도에서 잘려');
    expect(result.ok && result.plan.warnings[1]).toContain('.storyboard/cache/notes/responses.json');
    expect(warnings).toHaveLength(1);
    expect(savedResponses).toEqual([
      [
        { chunk: 1, noteIds: ['첫째.md'], failure: 'truncated', text: '{"notes":[' },
        { chunk: 2, noteIds: ['둘째.md'], text: '{"notes":[]}' },
      ],
    ]);
  });

  function readingOf(noteId: string, traits: string[]): NoteExtractionResult {
    return {
      extraction: extraction({
        entities: [entity({ name: '조만재', suggestedId: 'jo-manjae', traits, sourceNotes: [noteId] })],
      }),
      responseText: '{}',
    };
  }

  const twoReadings = [
    readingOf('첫째.md', ['허세가 심함']),
    readingOf('둘째.md', ['허세를 부린다', '고집이 세다']),
  ];

  it('asks once to merge the traits of a person read in two requests', async () => {
    const { useCase, warnings, consolidationRequests } = createUseCase(twoReadings, {
      consolidated: [{ cardId: 'jo-manjae', values: { traits: ['허세가 심함', '고집이 세다'] } }],
    });

    const result = await useCase.execute({ workspaceRoot, bundle });

    expect(consolidationRequests).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(result.ok && result.plan.cards[0]?.changes.map((change) => 'value' in change && change.value)).toEqual([
      '허세가 심함',
      '고집이 세다',
    ]);
  });

  it('keeps the merged traits and warns when the merge request fails', async () => {
    const { useCase, warnings } = createUseCase(twoReadings, { consolidated: [], failure: 'truncated' });

    const result = await useCase.execute({ workspaceRoot, bundle });

    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.cards[0]?.changes).toHaveLength(3);
    expect(warnings).toEqual([
      '카드 조만재 의 목록은 응답이 출력 한도에서 잘려 같은 뜻의 항목을 하나로 줄이지 못했습니다.',
    ]);
    expect(result.ok && result.plan.warnings[0]).toBe(warnings[0]);
  });

  it('sends each card in its own request and warns only about the one that failed', async () => {
    const readingOfTwo = (noteId: string): NoteExtractionResult => ({
      extraction: extraction({
        entities: ['jo-manjae', 'jeong-eunha'].map((id) =>
          entity({ name: id, suggestedId: id, description: [`${noteId} ${'가'.repeat(2_000)}`], sourceNotes: [noteId] }),
        ),
      }),
      responseText: '{}',
    });
    const { useCase, warnings, consolidationRequests } = createUseCase(
      [readingOfTwo('첫째.md'), readingOfTwo('둘째.md')],
      [{ consolidated: [{ cardId: 'jo-manjae', values: {} }] }, { consolidated: [], failure: 'truncated' }],
    );

    await useCase.execute({ workspaceRoot, bundle });

    expect(consolidationRequests).toHaveLength(2);
    expect(warnings).toEqual([
      '카드 jeong-eunha 의 목록은 응답이 출력 한도에서 잘려 같은 뜻의 항목을 하나로 줄이지 못했습니다.',
    ]);
  });

  it('shows the next request who the earlier requests found', async () => {
    const { useCase, knownCardRequests } = createUseCase(twoReadings);

    await useCase.execute({ workspaceRoot, bundle });

    expect(knownCardRequests).toEqual([
      [],
      [{ id: 'jo-manjae', type: 'character', name: '조만재', aliases: [] }],
    ]);
  });

  it('makes no merge request when nobody needs one', async () => {
    const { useCase, consolidationRequests } = createUseCase([
      readingOf('첫째.md', ['허세가 심함']),
      readable,
    ]);

    await useCase.execute({ workspaceRoot, bundle });

    expect(consolidationRequests).toEqual([]);
  });

  it('fails when no request could be read', async () => {
    const { useCase, savedResponses, warnings } = createUseCase([
      truncated,
      { ...truncated, failure: 'unparsed' },
    ]);

    const result = await useCase.execute({ workspaceRoot, bundle });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe(
      '노트 묶음 2개를 모두 읽지 못했습니다. 모델의 원문 응답은 .storyboard/cache/notes/responses.json 에 있습니다.',
    );
    expect(warnings[1]).toContain('응답에서 정리 결과(JSON)를 찾지 못해');
    expect(savedResponses).toHaveLength(1);
  });
});
