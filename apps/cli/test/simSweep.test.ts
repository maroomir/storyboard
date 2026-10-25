import { describe, expect, it } from 'vitest';

import type { RunRecord } from '@storyboard/story-sim';

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
  describeRegression,
  regressionRows,
  scoreRuns,
} from '@storyboard/story-sim';

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
  function point(label: string, auc: number, cost: number, recalled = 13, genre = 'thriller'): ScoredPoint {
    return { label, genre, auc, cost, recalled, contradicted: 0 };
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

  it('draws a separate frontier for each fixture', () => {
    const frontier = paretoFrontier([
      point('thriller/a', 0.9, 500),
      point('thriller/b', 0.5, 900),
      point('wuxia/a', 0.4, 10, 13, 'wuxia'),
    ]);

    expect(frontier.map((entry) => entry.label).sort()).toEqual(['thriller/a', 'wuxia/a']);
  });

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

    expect(withinCap(estimate, 20)).toBe(false);
    expect(withinCap(estimate, 36)).toBe(true);
    expect(withinCap(estimate, undefined)).toBe(true);
  });
});

describe('point score', () => {
  function run(overrides: Partial<RunRecord>): RunRecord {
    return {
      runId: 'r',
      genre: 'thriller',
      pointLabel: 'point',
      repeat: 1,
      engineCommit: 'e1',
      trackCommit: 't1',
      trackDirty: false,
      knobs: {},
      generation: { providerId: 'ollama', model: 'qwen3:14b' },
      scenes: [],
      tokens: {
        calls: 0,
        inputTokens: 100,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        byTask: {},
        costUsd: 0,
        unpricedCallCount: 0,
        unattributedCallCount: 0,
      },
      startedAt: '2026-09-14T00:00:00.000Z',
      wallClockMs: 1,
      ...overrides,
    };
  }

  it('takes the quality median over judged runs only', () => {
    const [point] = scoreRuns(
      [
        run({ repeat: 1, auc: 0.125, recalled: 4, floorGate: { passed: true, failures: [], abstained: [] } }),
        run({ repeat: 2, discarded: true }),
        run({ repeat: 3, auc: 0.119, recalled: 6 }),
        run({ repeat: 4, discarded: true, tokens: { ...run({}).tokens, inputTokens: 900 } }),
        run({ repeat: 5, discarded: true, tokens: { ...run({}).tokens, inputTokens: 700 } }),
      ],
      'tokens',
    );

    expect(point?.auc).toBeCloseTo(0.122);
    expect(point?.recalled).toBe(5);
    expect(point?.judged).toBe(2);
    expect(point?.gatePassed).toBe(1);
    expect(point?.runs).toBe(5);
    expect(point?.cost).toBe(100);
    expect(point?.judged).toBe(2);
  });

  it('keeps a point with no judged run but says so', () => {
    const [point] = scoreRuns([run({ discarded: true })], 'tokens');

    expect(point?.judged).toBe(0);
    expect(point?.auc).toBe(0);
  });

  it('scores runs from a different generator or prompt variant separately', () => {
    const scored = scoreRuns(
      [
        run({ auc: 0.1 }),
        run({ auc: 0.5, generation: { providerId: 'ollama', model: 'gemma4:12b', think: false } }),
        run({ auc: 0.9, generation: { providerId: 'ollama', model: 'qwen3:14b', promptVariant: 'rich' } }),
      ],
      'tokens',
    );

    expect(scored.map((point) => point.generation).sort()).toEqual([
      'ollama:gemma4:12b/nothink',
      'ollama:qwen3:14b',
      'ollama:qwen3:14b/rich',
    ]);
  });

  it('scores runs judged by different judges separately and keeps the judge cost', () => {
    const scored = scoreRuns(
      [
        run({ auc: 0.4, judge: { providerId: 'ollama', model: 'gemma3:12b' } }),
        run({
          auc: 0.7,
          judge: { providerId: 'claude', model: 'claude-sonnet-5' },
          judgeTokens: { calls: 100, inputTokens: 390000, outputTokens: 10000, cacheReadInputTokens: 0, byTask: {}, costUsd: 0.88, unpricedCallCount: 0, unattributedCallCount: 0 },
        }),
      ],
      'tokens',
    );

    expect(scored).toHaveLength(2);
    expect(scored.find((point) => point.judge === 'claude:claude-sonnet-5')?.judgeCostUsd).toBeCloseTo(0.88);
    expect(scored.find((point) => point.judge === 'ollama:gemma3:12b')?.judgeCostUsd).toBeUndefined();
  });

  it('scores runs from a different engine or track separately', () => {
    const scored = scoreRuns(
      [run({ auc: 0.1 }), run({ auc: 0.9, trackCommit: 't2' }), run({ auc: 0.5, engineCommit: 'e2' })],
      'tokens',
    );

    expect(scored).toHaveLength(3);
    expect(scored.map((point) => point.auc).sort()).toEqual([0.1, 0.5, 0.9]);
  });
});

describe('regression view', () => {
  function run(overrides: Partial<RunRecord>): RunRecord {
    return {
      runId: 'r',
      genre: 'thriller',
      pointLabel: 'point',
      repeat: 1,
      engineCommit: 'e1',
      trackCommit: 't1',
      trackDirty: false,
      knobs: {},
      generation: { providerId: 'ollama', model: 'gemma4:12b', think: false },
      scenes: [],
      tokens: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, byTask: {}, costUsd: 0, unpricedCallCount: 0, unattributedCallCount: 0 },
      startedAt: '2026-09-16T00:00:00.000Z',
      wallClockMs: 1,
      ...overrides,
    };
  }

  it('compares the latest engine with the previous one inside the noise floor', () => {
    const rows = regressionRows([
      run({ auc: 0.4, recalled: 8 }),
      run({ auc: 0.5, recalled: 8, repeat: 2 }),
      run({ auc: 0.45, recalled: 7, repeat: 3 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T00:00:00.000Z', auc: 0.48, recalled: 8 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T01:00:00.000Z', auc: 0.42, recalled: 9, repeat: 2 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ previousEngine: 'e1', latestEngine: 'e2', latestRuns: 2, previousRuns: 3, verdict: 'within-noise' });
    expect(rows[0]?.aucDelta).toBeCloseTo(0);
  });

  it('flags a move larger than the noise floor and refuses to judge a single run', () => {
    const outside = regressionRows([
      run({ auc: 0.4 }),
      run({ auc: 0.42, repeat: 2 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T00:00:00.000Z', auc: 0.2 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T01:00:00.000Z', auc: 0.22, repeat: 2 }),
    ]);
    expect(outside[0]?.verdict).toBe('outside-noise');

    const single = regressionRows([
      run({ auc: 0.4 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T00:00:00.000Z', auc: 0.2 }),
    ]);
    expect(single[0]?.verdict).toBe('undecidable');
  });

  it('reports engagement and critic deltas and lets engagement alone flag a move', () => {
    const panel = (engagement: number) => ({ byReader: {}, curves: {}, dropOffScene: {}, engagement });
    const critic = (groundedTotal: number) => ({
      groundedTotal,
      opinionTotal: 3,
      gatePassed: true,
      scores: [],
      gateReason: '',
      problems: [],
    });
    const rows = regressionRows([
      run({ auc: 0.05, panel: panel(0.3), critic: critic(7) }),
      run({ auc: 0.06, repeat: 2, panel: panel(0.32), critic: critic(6) }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T00:00:00.000Z', auc: 0.05, panel: panel(0.2), critic: critic(5) }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T01:00:00.000Z', auc: 0.07, repeat: 2, panel: panel(0.21), critic: critic(4) }),
    ]);

    expect(rows[0]?.engagementDelta).toBeCloseTo(-0.105);
    expect(rows[0]?.criticDelta).toBeCloseTo(-2);
    expect(rows[0]?.verdict).toBe('outside-noise');
    expect(describeRegression(rows[0]!)).toContain('몰입 -0.105');
    expect(describeRegression(rows[0]!)).toContain('비평 -2');
  });

  it('never compares runs made with different generators', () => {
    const rows = regressionRows([
      run({ auc: 0.4 }),
      run({ engineCommit: 'e2', startedAt: '2026-09-17T00:00:00.000Z', auc: 0.2, generation: { providerId: 'ollama', model: 'qwen3:14b' } }),
    ]);
    expect(rows).toHaveLength(0);
  });
});
