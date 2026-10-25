import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@storyboard/story-model';
import { describeCost, summarizeUsage } from '@storyboard/story-sim';

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    taskName: 'sceneSkeleton',
    providerId: 'claude',
    model: 'claude-sonnet-5',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    attribution: { primary: { kind: 'scene', id: '01-opening' } },
    ...overrides,
  };
}

describe('usage ledger', () => {
  it('sums tokens and groups them by task', () => {
    const totals = summarizeUsage([
      record(),
      record({ taskName: 'sceneSectionExpansion' }),
      record({ taskName: 'sceneSectionExpansion' }),
    ]);

    expect(totals.calls).toBe(3);
    expect(totals.inputTokens).toBe(3_000_000);
    expect(totals.byTask.sceneSectionExpansion).toEqual({
      calls: 2,
      inputTokens: 2_000_000,
      outputTokens: 2_000_000,
    });
  });

  it('refuses a total when any call had no price', () => {
    const totals = summarizeUsage([record(), record({ model: 'unlisted' })]);

    expect(totals.costUsd).toBeUndefined();
    expect(totals.unpricedCallCount).toBe(1);
  });

  it('prices a call from the model catalog when the provider sent no figure', () => {
    expect(summarizeUsage([record()]).costUsd).toBeCloseTo(12);
  });

  it('prefers the figure the provider itself reported', () => {
    expect(summarizeUsage([record({ costUsd: 0.5 })]).costUsd).toBeCloseTo(0.5);
  });

  it('counts records that arrived without attribution', () => {
    const totals = summarizeUsage([record({ attribution: {} })]);

    expect(totals.unattributedCallCount).toBe(1);
  });

  it('says why a total is missing rather than printing zero', () => {
    expect(describeCost(summarizeUsage([record({ costUsd: 0.5 })]))).toBe('$0.5000');
    expect(describeCost(summarizeUsage([record({ model: 'unlisted' })]))).toContain('금액 불명');
  });
});
