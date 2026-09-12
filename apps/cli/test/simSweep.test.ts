import { describe, expect, it } from 'vitest';

import {
  defaultGridLevels,
  estimateBudget,
  excludeBelowBaselineRecall,
  knobRegistry,
  median,
  noiseFloor,
  paretoFrontier,
  planFractionalGrid,
  planScreening,
  withinCap,
  type ScoredPoint,
} from '@storyboard/story-sim';

// 스윕 계획은 돈을 쓰기 전에 전부 결정된다. 여기가 틀리면 수천 번의 호출이 헛돈다.

const fourKnobs = knobRegistry.slice(0, 4);

describe('screening design', () => {
  it('runs the baseline plus at most two points per knob', () => {
    const points = planScreening(fourKnobs);

    expect(points[0]?.label).toBe('baseline');
    expect(points[0]?.knobs).toEqual({});
    expect(points.length).toBeLessThanOrEqual(1 + fourKnobs.length * 2);
  });

  it('moves exactly one knob at a time', () => {
    for (const point of planScreening(fourKnobs).slice(1)) {
      expect(Object.keys(point.knobs)).toHaveLength(1);
    }
  });

  it('keeps every screening value inside the knob bounds', () => {
    for (const point of planScreening(knobRegistry)) {
      for (const [id, value] of Object.entries(point.knobs)) {
        const knob = knobRegistry.find((candidate) => candidate.id === id);
        expect(value, id).toBeGreaterThanOrEqual(knob?.bounds.min ?? 0);
        expect(value, id).toBeLessThanOrEqual(knob?.bounds.max ?? 0);
      }
    }
  });
});

describe('fractional grid', () => {
  const levels = new Map(fourKnobs.map((knob) => [knob.id, defaultGridLevels(knob)]));

  it('plans nine points instead of eighty-one', () => {
    expect(planFractionalGrid(fourKnobs, levels)).toHaveLength(9);
  });

  // 직교성이 깨지면 주효과를 분해할 수 없고, 9점은 그냥 임의의 9점이 된다.
  it('gives every knob each level exactly three times', () => {
    const points = planFractionalGrid(fourKnobs, levels);

    for (const knob of fourKnobs) {
      const counts = new Map<number, number>();
      for (const point of points) {
        const value = point.knobs[knob.id] as number;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      expect([...counts.values()], knob.id).toEqual([3, 3, 3]);
    }
  });

  // 수준 횟수만 맞아도 직교가 아닐 수 있다. 어느 두 손잡이를 골라도 아홉 조합이 한 번씩
  // 나와야 두 손잡이의 효과가 서로 섞이지 않는다.
  it('gives every pair of knobs all nine level combinations exactly once', () => {
    const points = planFractionalGrid(fourKnobs, levels);

    for (let left = 0; left < fourKnobs.length; left += 1) {
      for (let right = left + 1; right < fourKnobs.length; right += 1) {
        const leftId = (fourKnobs[left] as (typeof fourKnobs)[number]).id;
        const rightId = (fourKnobs[right] as (typeof fourKnobs)[number]).id;
        const pairs = points.map((point) => `${point.knobs[leftId]}|${point.knobs[rightId]}`);

        expect(new Set(pairs).size, `${leftId} × ${rightId}`).toBe(9);
      }
    }
  });

  it('refuses a design that is not four knobs wide', () => {
    expect(() => planFractionalGrid(fourKnobs.slice(0, 3), levels)).toThrow(/L9/);
  });

  it('refuses a knob with no levels', () => {
    expect(() => planFractionalGrid(fourKnobs, new Map())).toThrow(/수준이 없습니다/);
  });
});

describe('pareto frontier', () => {
  function point(label: string, auc: number, cost: number, recalled = 13): ScoredPoint {
    return { label, auc, cost, recalled, contradicted: 0 };
  }

  it('drops a point that is worse on both axes', () => {
    const frontier = paretoFrontier([
      point('a', 0.8, 100),
      point('b', 0.7, 120),
      point('c', 0.6, 80),
    ]);

    expect(frontier.map((entry) => entry.label)).toEqual(['a', 'c']);
  });

  it('keeps a cheaper point even when its quality is lower', () => {
    const frontier = paretoFrontier([point('rich', 0.9, 500), point('cheap', 0.5, 10)]);

    expect(frontier).toHaveLength(2);
  });

  // 사실을 더 놓치는 지점은 거래 대상이 아니라 탈락이다.
  it('excludes a point that recalls fewer facts than the baseline', () => {
    const baseline = point('baseline', 0.6, 100, 12);
    const kept = excludeBelowBaselineRecall(
      [point('good', 0.9, 90, 12), point('forgetful', 0.95, 80, 9)],
      baseline,
    );

    expect(kept.map((entry) => entry.label)).toEqual(['good']);
  });
});

describe('repetition statistics', () => {
  it('takes the median, not the best sample', () => {
    expect(median([0.4, 0.9, 0.5])).toBe(0.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  // 씨앗이 없으므로 잡음 폭을 모르면 «4% 올랐다»가 반증 불가능한 문장이 된다.
  it('reports an infinite noise floor until the baseline was repeated', () => {
    expect(noiseFloor([0.5])).toBe(Number.POSITIVE_INFINITY);
    expect(noiseFloor([0.5, 0.58, 0.54])).toBeCloseTo(0.08);
  });
});

describe('budget estimate', () => {
  const baseline = {
    generationCallsPerScene: 7,
    inputTokensPerCall: 4000,
    outputTokensPerCall: 1500,
    secondsPerCall: 30,
    measuredAt: '2026-09-12',
  };

  it('multiplies points by repeats by scenes by calls', () => {
    const estimate = estimateBudget({
      points: 12,
      judgeCallsPerRun: 55,
      generationProvider: 'claude' as const,
      generationModel: 'claude-sonnet-5',
      baseline,
    });

    expect(estimate.generationCalls).toBe(12 * 3 * 8 * 7);
    expect(estimate.judgeCalls).toBe(12 * 3 * 55);
  });

  it('converts at the reference price and says so', () => {
    const estimate = estimateBudget({
      points: 1,
      repeats: 1,
      sceneCount: 1,
      judgeCallsPerRun: 0,
      generationProvider: 'claude' as const,
      generationModel: 'claude-sonnet-5',
      baseline: { ...baseline, generationCallsPerScene: 1000 },
    });

    // 1,000회 × (4,000 입력 + 1,500 출력) 토큰을 claude-sonnet-5 단가로.
    expect(estimate.estimatedUsd).toBeCloseTo((4_000_000 / 1e6) * 2 + (1_500_000 / 1e6) * 10);
  });

  it('leaves the cost at zero and says why for an unpriced model', () => {
    const estimate = estimateBudget({
      points: 1,
      judgeCallsPerRun: 0,
      generationProvider: 'claude' as const,
      generationModel: 'unlisted',
      baseline,
    });

    expect(estimate.estimatedUsd).toBeUndefined();
    expect(estimate.assumptions.join(' ')).toContain('요금을 몰라');
  });

  it('counts judge calls in the clock even though they leave the cost axis', () => {
    const withJudge = estimateBudget({
      points: 1,
      judgeCallsPerRun: 100,
      generationProvider: 'claude' as const,
      generationModel: 'claude-sonnet-5',
      baseline,
    });
    const withoutJudge = estimateBudget({
      points: 1,
      judgeCallsPerRun: 0,
      generationProvider: 'claude' as const,
      generationModel: 'claude-sonnet-5',
      baseline,
    });

    expect(withJudge.estimatedWallClockHours).toBeGreaterThan(
      withoutJudge.estimatedWallClockHours,
    );
    expect(withJudge.estimatedUsd).toBe(withoutJudge.estimatedUsd);
  });

  it('honours a run cap', () => {
    const estimate = estimateBudget({
      points: 12,
      judgeCallsPerRun: 0,
      generationProvider: 'claude' as const,
      generationModel: 'claude-sonnet-5',
      baseline,
    });

    // 12지점 × 3회 = 36회.
    expect(withinCap(estimate, 20)).toBe(false);
    expect(withinCap(estimate, 36)).toBe(true);
    expect(withinCap(estimate, undefined)).toBe(true);
  });
});
