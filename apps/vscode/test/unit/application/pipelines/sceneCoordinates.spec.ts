import { describe, expect, it } from 'vitest';

import {
  extractSceneCoordinates,
  listSceneCoordinates,
  sceneCoordinatesFromBeats,
  sectionSceneCoordinates,
} from '@storyboard/story-engine';

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
