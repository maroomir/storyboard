import { describe, expect, it } from 'vitest';

import type { UsageRecord } from '@storyboard/story-ai';
import { describeCost, summarizeUsage } from '@storyboard/story-sim';

// 비용 축의 유일한 오류 모드는 «모르는 값을 0으로 접는 것»이다. 그러면 모든 실행이 $0로 읽힌다.

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

  // 요금을 모르는 호출을 0으로 접으면 그 지점이 부당하게 싸 보인다. 총합을 말할 수 없으면 말하지 않는다.
  it('refuses a total when any call had no price', () => {
    const totals = summarizeUsage([record(), record({ model: 'unlisted' })]);

    expect(totals.costUsd).toBeUndefined();
    expect(totals.unpricedCallCount).toBe(1);
  });

  it('prices a call from the model catalog when the provider sent no figure', () => {
    // claude-sonnet-5 는 100만 토큰당 입력 $2 · 출력 $10.
    expect(summarizeUsage([record()]).costUsd).toBeCloseTo(12);
  });

  it('prefers the figure the provider itself reported', () => {
    expect(summarizeUsage([record({ costUsd: 0.5 })]).costUsd).toBeCloseTo(0.5);
  });

  // 귀속이 없는 호출은 사용량 이벤트를 아예 내지 않으므로, 0이 아니면 이미 샌 뒤다.
  it('counts records that arrived without attribution', () => {
    const totals = summarizeUsage([record({ attribution: {} })]);

    expect(totals.unattributedCallCount).toBe(1);
  });

  it('says why a total is missing rather than printing zero', () => {
    expect(describeCost(summarizeUsage([record({ costUsd: 0.5 })]))).toBe('$0.5000');
    expect(describeCost(summarizeUsage([record({ model: 'unlisted' })]))).toContain('금액 불명');
  });
});
