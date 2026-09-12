import { describe, expect, it } from 'vitest';

import {
  evaluateFloorGate,
  isQuoteGrounded,
  panelAuc,
  readerAuc,
  weightsOf,
  type ReaderCurve,
} from '@storyboard/story-sim';

// AUC 는 리포트의 첫 숫자다. 중도 이탈을 0으로 안 채우면 덮은 독자가 끝까지 읽은 것으로 계산된다.

function turn(sceneStem: string, engagement: number, continueReading = true) {
  return { sceneStem, engagement, continueReading, reason: '이유', quote: '인용' };
}

function curve(readerId: string, turns: ReturnType<typeof turn>[]): ReaderCurve {
  return { readerId, turns };
}

describe('drop-off curve', () => {
  it('scores a reader who finishes at full engagement as 1', () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 5));

    expect(readerAuc(curve('r1', turns), 8)).toBe(1);
  });

  // 3씬에서 덮은 독자는 4~8씬에 0을 채워야 한다. 안 그러면 이탈이 점수에 안 나타난다.
  it('fills zeros for every scene at or after the reader stopped', () => {
    const turns = [turn('01', 5), turn('02', 5), turn('03', 5, false)];

    expect(weightsOf(curve('r1', turns), 8)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    expect(readerAuc(curve('r1', turns), 8)).toBeCloseTo(3 / 8);
  });

  it('treats a missing turn as a zero rather than a gap', () => {
    expect(weightsOf(curve('r1', [turn('01', 5)]), 4)).toEqual([1, 0, 0, 0]);
  });

  it('clamps an engagement the judge returned out of range', () => {
    expect(weightsOf(curve('r1', [turn('01', 99), turn('02', -3)]), 2)).toEqual([1, 0]);
  });
});

describe('panel AUC', () => {
  const finished = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 5));
  const quitEarly = [turn('01', 5), turn('02', 5), turn('03', 5, false)];

  it('averages the common readers', () => {
    const result = panelAuc(
      [curve('a', finished), curve('b', finished), curve('c', finished), curve('d', quitEarly)],
      8,
    );

    expect(result.auc).toBeCloseTo((1 + 1 + 1 + 3 / 8) / 4);
  });

  // 스칼라 하나로는 «넷 다 미지근»과 «셋은 좋고 하나가 일찍 덮음»이 구분되지 않는다.
  it('keeps the per-reader curves and the drop-off scene beside the scalar', () => {
    const lukewarm = Array.from({ length: 8 }, (_, index) => turn(`0${index + 1}`, 2));
    const spread = panelAuc(
      [curve('a', finished), curve('b', finished), curve('c', finished), curve('d', quitEarly)],
      8,
    );
    const flat = panelAuc(
      [curve('a', lukewarm), curve('b', lukewarm), curve('c', lukewarm), curve('d', lukewarm)],
      8,
    );

    expect(flat.auc).toBeCloseTo(0.4);
    expect(spread.dropOffScene['d']).toBe('03');
    expect(flat.dropOffScene['d']).toBeUndefined();
    expect(spread.byReader['a']).toBe(1);
  });

  it('returns zero for an empty panel rather than a NaN', () => {
    expect(panelAuc([], 8).auc).toBe(0);
  });
});

describe('floor gate', () => {
  it('passes when every reader put the corrupted draft last', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', ranking: ['generated', 'floor'] },
      { readerId: 'b', ranking: ['generated', 'floor'] },
    ]);

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  // 한 명이라도 훼손본을 위로 올리면 그 회차의 눈금을 믿을 수 없다.
  it('fails and names the reader who did not', () => {
    const result = evaluateFloorGate([
      { readerId: 'a', ranking: ['generated', 'floor'] },
      { readerId: 'b', ranking: ['floor', 'generated'] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('b');
  });

  it('fails when no ranking arrived at all', () => {
    expect(evaluateFloorGate([]).passed).toBe(false);
  });
});

describe('quote grounding', () => {
  it('accepts a quote that differs only in whitespace', () => {
    expect(isQuoteGrounded('문을 열었다', '그는  문을\n열었다.')).toBe(true);
  });

  it('rejects a quote the draft never contained', () => {
    expect(isQuoteGrounded('창문을 닫았다', '그는 문을 열었다.')).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(isQuoteGrounded('   ', '그는 문을 열었다.')).toBe(false);
  });
});
