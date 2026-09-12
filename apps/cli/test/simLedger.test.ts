import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@storyboard/story-ai';
import { describeCost, referencePriceFor, summarizeUsage } from '@storyboard/story-sim';

// 비용 축의 유일한 오류 모드는 «모르는 값을 0으로 접는 것»이다. 그러면 모든 실행이 $0로 읽힌다.

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    taskName: 'sceneSkeleton',
    providerId: 'claude-code',
    model: 'sonnet',
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

  // 일부만 보고됐을 때 부분합을 내면 «싸 보이는» 지점이 이긴다. 총합을 말할 수 없으면 말하지 않는다.
  it('refuses a partial total when any call reported no cost', () => {
    const totals = summarizeUsage([record({ costUsd: 0.5 }), record()]);

    expect(totals.costReportedUsd).toBeUndefined();
    expect(totals.unpricedCallCount).toBe(1);
  });

  it('reports the total when every call carried a cost', () => {
    const totals = summarizeUsage([record({ costUsd: 0.5 }), record({ costUsd: 0.25 })]);

    expect(totals.costReportedUsd).toBeCloseTo(0.75);
    expect(totals.unpricedCallCount).toBe(0);
  });

  it('converts tokens at the reference price regardless of what the CLI reported', () => {
    const price = referencePriceFor('sonnet');
    const totals = summarizeUsage([record()]);

    expect(price).toEqual({ input: 3, output: 15 });
    expect(totals.costRefUsd).toBeCloseTo(18);
  });

  it('leaves the reference cost at zero for a model it has no price for', () => {
    expect(summarizeUsage([record({ model: 'unlisted' })]).costRefUsd).toBe(0);
  });

  // 귀속이 없는 호출은 사용량 이벤트를 아예 내지 않으므로, 0이 아니면 이미 샌 뒤다.
  it('counts records that arrived without attribution', () => {
    const totals = summarizeUsage([record({ attribution: {} })]);

    expect(totals.unattributedCallCount).toBe(1);
  });

  it('always labels the converted figure, and says why a total is missing', () => {
    expect(describeCost(summarizeUsage([record({ costUsd: 0.5 })]))).toContain('(ref)');
    expect(describeCost(summarizeUsage([record()]))).toContain('보고된 금액 없음');
  });
});
