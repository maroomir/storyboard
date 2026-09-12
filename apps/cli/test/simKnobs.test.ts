import { describe, expect, it } from 'vitest';

import { pipelineDefaults, sectionViolationKinds } from '@storyboard/story-pipeline';
import { applyOverlay, findKnob, knobRegistry, simDefaults } from '@storyboard/story-sim';

// 레지스트리가 데이터 파일과 어긋나면 스윕이 존재하지 않는 손잡이를 흔들거나, 있는 손잡이를
// 빠뜨린 채 «영향 없음»으로 보고한다. 둘 다 조용히 틀린 결론이 된다.

function leavesOf(value: unknown, path = ''): string[] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      leavesOf(child, path === '' ? key : `${path}.${key}`),
    );
  }
  return [path];
}

describe('knob registry', () => {
  const excluded = 'context.maxSceneBreakNewlines';

  it('has one row per pipeline default, except the one the pipeline never reads', () => {
    const expected = leavesOf(pipelineDefaults).filter((leaf) => leaf !== excluded);
    const registered = knobRegistry.map((knob) => knob.id);

    expect([...registered].sort()).toEqual([...expected].sort());
  });

  it('never registers the excluded knob', () => {
    expect(findKnob(excluded)).toBeUndefined();
  });

  it('takes every default from the data file, not a second copy', () => {
    for (const knob of knobRegistry) {
      const [group, leaf] = knob.id.split('.') as [string, string];
      const source = (pipelineDefaults as unknown as Record<string, Record<string, number>>)[group];

      expect(knob.defaultValue, knob.id).toBe(source?.[leaf]);
    }
  });

  it('keeps every default inside its own bounds', () => {
    for (const knob of knobRegistry) {
      expect(knob.defaultValue, knob.id).toBeGreaterThanOrEqual(knob.bounds.min);
      expect(knob.defaultValue, knob.id).toBeLessThanOrEqual(knob.bounds.max);
    }
  });

  it('covers the whole violation scale', () => {
    const weights = knobRegistry.filter((knob) => knob.weightKind !== undefined);

    expect(weights.map((knob) => knob.weightKind).sort()).toEqual([...sectionViolationKinds].sort());
  });
});

describe('overlay', () => {
  it('builds the tuning object a valid overlay asks for', () => {
    const { tuning, refusals } = applyOverlay(
      { knobs: { 'skeleton.lengthRatio': 0.5, 'section.retryLimit': 3, 'violationWeights.cast': 5 } },
      'claude-code',
    );

    expect(refusals).toEqual([]);
    expect(tuning).toEqual({
      skeletonRatio: 0.5,
      sectionRetryLimit: 3,
      violationWeights: { cast: 5 },
    });
  });

  it('refuses an unknown knob', () => {
    const { refusals } = applyOverlay({ knobs: { 'skeleton.nope': 1 } }, 'claude-code');

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('모르는 손잡이');
  });

  it('refuses a value outside the bounds', () => {
    const { refusals } = applyOverlay({ knobs: { 'skeleton.lengthRatio': 9 } }, 'claude-code');

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('범위 밖');
  });

  // 무효인 손잡이를 태우면 회차마다 같은 값이 나오고 «영향 없음»으로 읽힌다. 시작 전에 막는다.
  it('refuses a knob the generation provider ignores', () => {
    const base = knobRegistry[0] as (typeof knobRegistry)[number];
    const registry = [{ ...base, honouredBy: ['openai'] as const }];

    const { refusals, tuning } = applyOverlay(
      { knobs: { [base.id]: base.defaultValue } },
      'claude-code',
      registry,
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('무시됩니다');
    expect(tuning).toEqual({});
  });

  it('accepts the same knob on a provider that honours it', () => {
    const base = knobRegistry[0] as (typeof knobRegistry)[number];
    const registry = [{ ...base, honouredBy: ['openai'] as const }];

    const { refusals } = applyOverlay(
      { knobs: { [base.id]: base.defaultValue } },
      'openai',
      registry,
    );

    expect(refusals).toEqual([]);
  });

  it('leaves the tuning empty when every knob was refused', () => {
    const { tuning } = applyOverlay({ knobs: { 'skeleton.nope': 1 } }, 'claude-code');

    expect(tuning).toEqual({});
  });
});

describe('sim defaults', () => {
  it('prices every model the sweep can select', () => {
    expect(Object.keys(simDefaults.referencePricePerMillion).sort()).toEqual([
      'haiku',
      'opus',
      'sonnet',
    ]);
  });

  it('keeps the panel and repeat counts positive', () => {
    expect(simDefaults.panel.commonReaderCount).toBeGreaterThan(0);
    expect(simDefaults.run.repeats).toBeGreaterThan(0);
  });
});
