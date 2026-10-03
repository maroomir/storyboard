import { computeCostUsd } from '@storyboard/story-ai';
import type { AiTaskName, UsageRecord } from '@storyboard/story-model';

export interface TaskUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// NOTE: 남은 프로바이더는 전부 종량제라 모델마다 요금이 필수 칸이다. 그래서 금액은 하나뿐이고
// 환산값을 따로 들 이유가 없다. 다만 요금을 모르는 호출(목록에 없는 모델)까지 0으로 접으면
// 모든 실행이 공짜로 읽히므로, 한 호출이라도 값을 모르면 총합을 undefined 로 둔다.
export interface TokenTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly byTask: Readonly<Partial<Record<AiTaskName, TaskUsage>>>;
  readonly costUsd: number | undefined;
  readonly unpricedCallCount: number;
  // 귀속이 없는 호출은 사용량 이벤트를 아예 내지 않는다. 0 이 아니면 토큰이 새고 있다는 뜻이다.
  readonly unattributedCallCount: number;
}

export function summarizeUsage(records: readonly UsageRecord[]): TokenTotals {
  const byTask: Partial<Record<AiTaskName, TaskUsage>> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let costTotal = 0;
  let unpricedCallCount = 0;
  let unattributedCallCount = 0;

  for (const record of records) {
    const input = record.usage?.inputTokens ?? 0;
    const output = record.usage?.outputTokens ?? 0;

    inputTokens += input;
    outputTokens += output;
    cacheReadInputTokens += record.usage?.cacheReadInputTokens ?? 0;

    const previous = byTask[record.taskName];
    byTask[record.taskName] = {
      calls: (previous?.calls ?? 0) + 1,
      inputTokens: (previous?.inputTokens ?? 0) + input,
      outputTokens: (previous?.outputTokens ?? 0) + output,
    };

    // 프로바이더가 금액을 실어 보냈으면 그걸 쓰고, 없으면 토큰과 모델 요금으로 센다.
    const cost =
      record.costUsd ??
      computeCostUsd({ providerId: record.providerId, model: record.model, usage: record.usage });

    if (cost === undefined) {
      unpricedCallCount += 1;
    } else {
      costTotal += cost;
    }

    if (record.attribution.primary === undefined) {
      unattributedCallCount += 1;
    }
  }

  return {
    calls: records.length,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    byTask,
    costUsd: unpricedCallCount > 0 ? undefined : costTotal,
    unpricedCallCount,
    unattributedCallCount,
  };
}

export function describeCost(totals: TokenTotals): string {
  if (totals.costUsd === undefined) {
    return `금액 불명 — 요금을 모르는 호출 ${totals.unpricedCallCount}/${totals.calls}건`;
  }

  return `$${totals.costUsd.toFixed(4)}`;
}
