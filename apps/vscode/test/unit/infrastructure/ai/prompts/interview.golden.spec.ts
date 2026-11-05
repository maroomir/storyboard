import { describe, expect, it } from 'vitest';

import {
  InterviewAxesPrompt,
  InterviewDistillPrompt,
  InterviewQuestionPrompt,
  InterviewRelationSpeechPrompt,
  InterviewUpdatePrompt,
  coerceInterviewAxes,
  coerceInterviewDistill,
  coerceInterviewQuestion,
  coerceInterviewRelationSpeech,
  coerceInterviewUpdate,
} from '@storyboard/story-ai';
import type { InterviewAxis } from '@storyboard/story-model';

const axis: InterviewAxis = {
  id: 'pressure-defense',
  label: '압박 아래 방어',
  values: [
    { id: 'counter', label: '역공' },
    { id: 'withhold', label: '침묵' },
    { id: 'deflect', label: '비탈' },
  ],
};

describe('interview prompts golden', () => {
  it.each(['generic', 'xs'] as const)('renders the axes prompt for the %s variant', (variant) => {
    expect(
      InterviewAxesPrompt.build(
        {
          cardType: 'character',
          genre: '학원 로맨스',
          audience: '10대',
          concept: '소꿉친구와의 재회',
          synopsis: '하나는 세부로 돌아온다 / 담담한 코미디',
          prohibitions: ['무근거 부활 금지'],
          existingAxes: [axis],
          scenes: ['12. 미감의 밤 — 준이 하나를 심문한다 — 관계: 냉전'],
          maxAxes: 12,
        },
        variant,
      ),
    ).toMatchSnapshot();
    expect(
      InterviewAxesPrompt.build(
        { cardType: 'background', prohibitions: [], existingAxes: [], scenes: [], maxAxes: 8 },
        variant,
      ),
    ).toMatchSnapshot();
  });

  it.each(['generic', 'xs'] as const)('renders the question prompt for the %s variant', (variant) => {
    expect(
      InterviewQuestionPrompt.build(
        {
          cardType: 'character',
          name: '하나',
          genre: '학원 로맨스',
          summary: '하나는 몰릴 때 먼저 참는다.',
          relationSpeech: ["하나 → 준: '선배'라 부르고 존댓말"],
          axes: [{ ...axis, unseenValueIds: ['deflect'] }],
          situation: '01-night: 준이 하나를 심문한다 (출연: 하나, 준 / 장소: 미감)',
          presence: { presentNames: ['하나', '준'] },
          isOffBeat: false,
          priorAnswers: ['01-night: 하나가 자리를 뜨려 한다 → 압박 아래 방어: 침묵 — 잔만 본다'],
          optionCount: 3,
          shouldExplore: true,
        },
        variant,
      ),
    ).toMatchSnapshot();
    expect(
      InterviewQuestionPrompt.build(
        {
          cardType: 'background',
          name: '미감',
          summary: '항구 뒷골목의 술집',
          relationSpeech: [],
          axes: [{ id: 'exits', label: '드나드는 길', values: [{ id: 'single-door', label: '정문 하나' }, { id: 'back-door', label: '뒷문 있음' }], unseenValueIds: [] }],
          situation: '드나드는 길이 드러나는 상황을 하나 세워 물어라.',
          isOffBeat: true,
          priorAnswers: [],
          optionCount: 2,
          shouldExplore: false,
        },
        variant,
      ),
    ).toMatchSnapshot();
    expect(
      InterviewQuestionPrompt.build(
        {
          cardType: 'character',
          name: '하나',
          summary: '하나는 몰릴 때 먼저 참는다.',
          relationSpeech: [],
          axes: [{ ...axis, unseenValueIds: [] }],
          situation: '02-dawn: 하나가 준의 방에서 편지를 찾는다',
          presence: { presentNames: [], precedingBeat: '하나가 혼자 등대로 돌아온다' },
          isOffBeat: false,
          priorAnswers: [],
          optionCount: 3,
          shouldExplore: false,
        },
        variant,
      ),
    ).toMatchSnapshot();
  });

  it.each(['generic', 'xs'] as const)('renders the update prompt for the %s variant', (variant) => {
    const base = {
      cardType: 'character' as const,
      name: '하나',
      summary: '하나는 몰릴 때 먼저 참는다.',
      relationSpeech: [] as readonly string[],
      axis,
      situation: '준이 하나를 심문한다',
      question: '하나의 첫 반응은?',
      options: [
        { valueId: 'counter', text: '“물어볼 게 그게 다예요?”' },
        { valueId: 'withhold', text: '잔을 내려놓고 침묵한다' },
      ],
    };

    expect(
      InterviewUpdatePrompt.build(
        { ...base, relationSpeech: ["하나 → 준: '선배'라 부르고 존댓말"], answer: '잔을 내려놓고 침묵한다', isWritten: false },
        variant,
      ),
    ).toMatchSnapshot();
    expect(InterviewUpdatePrompt.build({ ...base, answer: '웃어 버린다', isWritten: true }, variant)).toMatchSnapshot();
    expect(
      InterviewUpdatePrompt.build(
        {
          ...base,
          answer: '고개를 돌린다',
          isWritten: false,
          rebuild: { cardText: 'type: character\nid: hana\nname: 하나\n', records: ['준이 하나를 심문한다 → 압박 아래 방어: 웃음으로 넘기기 — 웃어 버린다'] },
        },
        variant,
      ),
    ).toMatchSnapshot();
  });

  it.each(['generic', 'xs'] as const)('renders the distill prompt for the %s variant', (variant) => {
    expect(
      InterviewDistillPrompt.build(
        {
          cardType: 'character',
          name: '하나',
          cardText: 'type: character\nid: hana\nname: 하나\n',
          summary: '하나는 몰릴 때 먼저 참는다.',
          tallies: ['압박 아래 방어: 침묵 ×2'],
          choices: ['준이 하나를 심문한다 → 압박 아래 방어: 침묵'],
          written: ['준이 소리를 높인다 → 압박 아래 방어: 웃어 버린다'],
          relationTargets: ['jun'],
          minimumWeight: 2,
        },
        variant,
      ),
    ).toMatchSnapshot();
    expect(
      InterviewDistillPrompt.build(
        {
          cardType: 'background',
          name: '미감',
          cardText: 'type: location\nid: tavern\nname: 미감\n',
          summary: '항구 뒷골목의 술집',
          tallies: ['드나드는 길: 뒷문 있음 ×2'],
          choices: [],
          written: [],
          relationTargets: [],
          minimumWeight: 2,
        },
        variant,
      ),
    ).toMatchSnapshot();
  });
});

describe('interview relation speech prompt golden', () => {
  it.each(['generic', 'xs'] as const)('renders the relation speech question for the %s variant', (variant) => {
    expect(
      InterviewRelationSpeechPrompt.build(
        {
          name: '조만재',
          catchphrases: ['이 몸', '엘리트', '평민'],
          targetId: 'jung-eun-ha',
          targetName: '정은하',
          targetAliases: ['은하', '갤럭시'],
          currentSpeech: '반말',
          scenes: ['01. 첫 만남 — 은하가 문을 열어 준다'],
          optionCount: 3,
        },
        variant,
      ),
    ).toMatchSnapshot();
  });

  it('keeps distinct option texts and needs a question', () => {
    expect(
      coerceInterviewRelationSpeech({ question: ' 무엇이라 부르나? ', options: [{ text: '엘리트라 부름' }, { text: '엘리트라 부름' }, '이름을 부름', { text: '' }] }),
    ).toEqual({ question: '무엇이라 부르나?', options: ['엘리트라 부름', '이름을 부름'] });
    expect(coerceInterviewRelationSpeech({ question: 'q', options: [{ text: '하나' }] })).toBeUndefined();
  });
});

describe('interview response coercion', () => {
  it('keeps only well-formed axes with at least two distinct values', () => {
    expect(
      coerceInterviewAxes({
        axes: [
          { id: 'Pressure-Defense', label: '압박', values: [{ id: 'counter', label: '역공' }, { id: 'counter', label: '중복' }, { id: 'withhold', label: '침묵' }] },
          { id: 'bad id', label: '무시', values: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] },
          { id: 'lonely', label: '값 하나', values: [{ id: 'only', label: '하나' }] },
        ],
      }),
    ).toEqual([
      { id: 'pressure-defense', label: '압박', values: [{ id: 'counter', label: '역공' }, { id: 'withhold', label: '침묵' }] },
    ]);
    expect(coerceInterviewAxes(null)).toEqual([]);
  });

  it('drops options with unknown or repeated values and falls back to the only open axis', () => {
    const draft = coerceInterviewQuestion(
      {
        question: '어떻게 하는가?',
        options: [
          { valueId: 'counter', text: '받아친다' },
          { valueId: 'counter', text: '또 받아친다' },
          { valueId: 'ghost', text: '없는 값' },
          { valueId: 'withhold', text: '침묵한다' },
        ],
      },
      [axis],
    );

    expect(draft).toEqual({
      axisId: 'pressure-defense',
      question: '어떻게 하는가?',
      options: [
        { valueId: 'counter', text: '받아친다' },
        { valueId: 'withhold', text: '침묵한다' },
      ],
    });
    expect(coerceInterviewQuestion({ axisId: 'other', question: 'q', options: [] }, [axis, { ...axis, id: 'b' }])).toBeUndefined();
    expect(coerceInterviewQuestion({ question: 'q', options: [{ valueId: 'counter', text: 'a' }] }, [axis])).toBeUndefined();
  });

  it('accepts a known value, a new value, or no classification on an update', () => {
    expect(coerceInterviewUpdate({ summary: ' 요약 ', classification: { valueId: 'withhold' } }, axis)).toEqual({
      summary: '요약',
      classification: { kind: 'value', valueId: 'withhold' },
    });
    expect(
      coerceInterviewUpdate({ summary: '요약', classification: { newValue: { id: 'Laugh-Off', label: '웃음으로 넘기기' } } }, axis),
    ).toEqual({ summary: '요약', classification: { kind: 'newValue', id: 'laugh-off', label: '웃음으로 넘기기' } });
    expect(coerceInterviewUpdate({ summary: '요약', classification: { newValue: { id: 'counter', label: '이미 있음' } } }, axis)).toEqual({
      summary: '요약',
    });
    expect(coerceInterviewUpdate({ summary: '' }, axis)).toBeUndefined();
  });

  it('keeps relation speech only for known targets', () => {
    expect(
      coerceInterviewDistill(
        { traits: ['참는다'], relationSpeech: [{ target: 'jun', speech: '반말' }, { target: 'ghost', speech: '존댓말' }], layout: 'not a list' },
        ['jun'],
      ),
    ).toEqual({
      traits: ['참는다'],
      voice: [],
      desire: [],
      description: [],
      relationSpeech: [{ target: 'jun', speech: '반말' }],
      layout: [],
      rules: [],
      senses: [],
    });
  });
});
