import { describe, expect, it } from 'vitest';

import {
  countMissingSceneCoordinates,
  extractSceneCoordinates,
  listSceneCoordinates,
  placeWordSet,
  sceneCoordinatesFromBeats,
  sectionPlaces,
  sectionSceneCoordinates,
} from '@storyboard/story-engine';
import type { SceneBeat } from '@storyboard/story-model';

const morning = '시각: 아침 / 장소: 거실 / 있는 사람: 나, 은하';
const afternoon = '시각: 방과 후 / 장소: 교문 앞 / 있는 사람: 나';
const night = '시각: 밤 / 장소: 발코니 가림막 뒤 / 있는 사람: 나';

describe('scene coordinate markers', () => {
  it('moves each marker into the ledger by its break and removes it from the skeleton', () => {
    const skeleton = [
      `⟪${morning}⟫`,
      '나는 떡볶이를 떠먹었다.',
      '',
      '---',
      '',
      `⟪${afternoon}⟫`,
      '그날 오후, 교문을 빠져나왔다.',
    ].join('\n');

    const extracted = extractSceneCoordinates(skeleton);

    expect(extracted.text).toBe('나는 떡볶이를 떠먹었다.\n\n---\n\n그날 오후, 교문을 빠져나왔다.');
    expect(extracted.ledger.segments).toEqual([morning, afternoon]);
    expect(extracted.ledger.isAlignedWithBreaks).toBe(true);
  });

  it('keeps the prose of a line that carries an inline marker and leaves a gap for a missing one', () => {
    const extracted = extractSceneCoordinates(
      ['첫 대목.', '---', `⟪${afternoon}⟫ 교문을 나섰다.`].join('\n'),
    );

    expect(extracted.text).toBe('첫 대목.\n---\n교문을 나섰다.');
    expect(extracted.ledger.segments).toEqual([undefined, afternoon]);
    expect(listSceneCoordinates(extracted.ledger)).toEqual([`2. ${afternoon}`]);
    expect(countMissingSceneCoordinates(extracted.ledger)).toBe(1);
  });

  it('keeps a slot for a trailing segment whose marker is missing', () => {
    const extracted = extractSceneCoordinates(
      [`⟪${morning}⟫`, '첫 대목.', '---', '둘째 대목.', '---', '셋째 대목.'].join('\n'),
    );

    expect(extracted.ledger.segments).toEqual([morning, undefined, undefined]);
    expect(countMissingSceneCoordinates(extracted.ledger)).toBe(2);
  });

  it('counts nothing missing when the skeleton has no markers at all', () => {
    expect(countMissingSceneCoordinates(extractSceneCoordinates('첫 대목.\n---\n둘째 대목.').ledger)).toBe(0);
  });

  it('falls back to object beat coordinates, merging consecutive repeats', () => {
    const ledger = sceneCoordinatesFromBeats(
      [
        { text: '일어난다', place: '거실', time: '아침', cast: ['ina'] },
        { text: '밥을 먹는다', place: '거실', time: '아침', cast: ['ina'] },
        '문자열 비트',
        { text: '하교', place: '교문 앞', time: '방과 후' },
      ],
      (ref) => (ref === 'ina' ? '이나' : ref),
    );

    expect(ledger.isAlignedWithBreaks).toBe(false);
    expect(ledger.segments).toEqual([
      '출연: 이나 / 장소: 거실 / 시각: 아침',
      '장소: 교문 앞 / 시각: 방과 후',
    ]);
  });
});

describe('section scene coordinates', () => {
  const ledger = { segments: [morning, afternoon, night], isAlignedWithBreaks: true };

  it('marks the segments each section covers, a trailing break starting the next one', () => {
    const sections = ['아침 대목\n\n---', '오후 대목\n\n---\n\n밤 대목'];

    expect(sectionSceneCoordinates(ledger, sections)).toEqual([
      [`1. ${morning} ← 이번 구간`, `2. ${afternoon}`, `3. ${night}`],
      [`1. ${morning}`, `2. ${afternoon} ← 이번 구간`, `3. ${night} ← 이번 구간`],
    ]);
  });

  it('lists beat coordinates unmarked when they are not aligned with the breaks', () => {
    const fromBeats = { segments: [morning, afternoon], isAlignedWithBreaks: false };

    expect(sectionSceneCoordinates(fromBeats, ['한 구간'])).toEqual([
      [`1. ${morning}`, `2. ${afternoon}`],
    ]);
  });

  it('gives nothing when the ledger is empty', () => {
    expect(
      sectionSceneCoordinates({ segments: [], isAlignedWithBreaks: true }, ['a', 'b']),
    ).toEqual([[], []]);
  });
});

// #122: 한 대목이 여러 비트에 걸치면 구간 쓰기는 비트별 장소를 알아야 인물을 좌표 밖의 방으로 옮기지 않는다.
describe('section beat coordinates', () => {
  const beats: SceneBeat[] = [
    { text: '소파에서 성재와 말한다', place: '집 거실', time: '저녁 8시', cast: ['mj', 'sj'] },
    { text: '동생이 캐묻는다', place: '집 거실', time: '저녁 8시 20분' },
    { text: '엄마와 은하가 돌아온다', place: '집 현관과 거실', time: '저녁 8시 45분' },
    '문자열 비트',
    { text: '옥상에 오른다', place: '옥상 발코니', time: '밤 9시' },
  ];
  const ledger = {
    segments: ['장소: 집 거실 → 집 현관과 거실 / 시각: 저녁 8시 ~ 저녁 8시 45분', '장소: 옥상 발코니 / 시각: 밤 9시'],
    isAlignedWithBreaks: true,
    beats: [[0, 1, 2, 3], [4]],
  };
  const sections = ['거실 대목\n\n---', '옥상 대목'];

  it('lists the beats of the segments this section covers under their segment line', () => {
    expect(sectionSceneCoordinates(ledger, sections, beats, (ref) => (ref === 'mj' ? '만재' : '성재'))).toEqual([
      [
        '1. 장소: 집 거실 → 집 현관과 거실 / 시각: 저녁 8시 ~ 저녁 8시 45분 ← 이번 구간',
        '  1-1. 출연: 만재, 성재 / 장소: 집 거실 / 시각: 저녁 8시 — 소파에서 성재와 말한다',
        '  1-2. 장소: 집 거실 / 시각: 저녁 8시 20분 — 동생이 캐묻는다',
        '  1-3. 장소: 집 현관과 거실 / 시각: 저녁 8시 45분 — 엄마와 은하가 돌아온다',
        '2. 장소: 옥상 발코니 / 시각: 밤 9시',
      ],
      [
        '1. 장소: 집 거실 → 집 현관과 거실 / 시각: 저녁 8시 ~ 저녁 8시 45분',
        '2. 장소: 옥상 발코니 / 시각: 밤 9시 ← 이번 구간',
        '  2-5. 장소: 옥상 발코니 / 시각: 밤 9시 — 옥상에 오른다',
      ],
    ]);
  });

  it('keeps the segment lines alone when the ledger does not know its beats', () => {
    const withoutBeats = { segments: ledger.segments, isAlignedWithBreaks: true };

    expect(sectionSceneCoordinates(withoutBeats, sections, beats)).toEqual([
      ['1. 장소: 집 거실 → 집 현관과 거실 / 시각: 저녁 8시 ~ 저녁 8시 45분 ← 이번 구간', '2. 장소: 옥상 발코니 / 시각: 밤 9시'],
      ['1. 장소: 집 거실 → 집 현관과 거실 / 시각: 저녁 8시 ~ 저녁 8시 45분', '2. 장소: 옥상 발코니 / 시각: 밤 9시 ← 이번 구간'],
    ]);
    expect(sectionPlaces(withoutBeats, sections, beats)).toEqual([[], []]);
  });

  it('names the distinct places of each section and their matching words', () => {
    expect(sectionPlaces(ledger, sections, beats)).toEqual([['집 거실', '집 현관과 거실'], ['옥상 발코니']]);
    expect([...placeWordSet(['집 현관과 거실', '옥상 발코니 앞'])]).toEqual(['현관', '거실', '옥상', '발코니']);
  });
});
