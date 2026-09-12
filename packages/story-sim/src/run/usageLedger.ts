import type { AiTaskName, UsageRecord } from '@storyboard/story-ai';

import { simDefaults } from '#sim/simDefaults';

export interface TaskUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// NOTE: 비용은 서로 다른 세 가지 사실이고 어느 둘도 합치면 안 된다. costReportedUsd 는 CLI 가
// 실제로 보고한 금액이라 한 호출이라도 빠지면 총합을 말할 수 없어 undefined 가 된다.
// costRefUsd 는 지점끼리 비교하려고 토큰을 참조 단가로 환산한 값이라 청구액이 아니다.
// unpricedCallCount 는 금액이 없던 호출 수로, undefined 의 이유를 설명한다.
export interface TokenTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly byTask: Readonly<Partial<Record<AiTaskName, TaskUsage>>>;
  readonly costReportedUsd: number | undefined;
  readonly costRefUsd: number;
  readonly unpricedCallCount: number;
  // 귀속이 없는 호출은 사용량 이벤트를 아예 내지 않는다. 0 이 아니면 토큰이 새고 있다는 뜻이다.
  readonly unattributedCallCount: number;
}

export interface ReferencePrice {
  readonly input: number;
  readonly output: number;
}

export function referencePriceFor(model: string | undefined): ReferencePrice | undefined {
  return model === undefined ? undefined : simDefaults.referencePricePerMillion[model];
}

export function summarizeUsage(
  records: readonly UsageRecord[],
  fallbackModel?: string,
): TokenTotals {
  const byTask: Partial<Record<AiTaskName, TaskUsage>> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let costRefUsd = 0;
  let reportedTotal = 0;
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

    if (record.costUsd === undefined) {
      unpricedCallCount += 1;
    } else {
      reportedTotal += record.costUsd;
    }

    if (record.attribution.primary === undefined) {
      unattributedCallCount += 1;
    }

    const price = referencePriceFor(record.model ?? fallbackModel);
    if (price !== undefined) {
      costRefUsd += (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;
    }
  }

  return {
    calls: records.length,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    byTask,
    costReportedUsd: unpricedCallCount > 0 ? undefined : reportedTotal,
    costRefUsd,
    unpricedCallCount,
    unattributedCallCount,
  };
}

// 리포트 한 줄. 실제 청구액과 환산값을 한 줄에 쓰되 어느 쪽인지 늘 밝힌다.
export function describeCost(totals: TokenTotals): string {
  const reference = `$${totals.costRefUsd.toFixed(4)} (ref)`;

  if (totals.costReportedUsd === undefined) {
    return `${reference} · 보고된 금액 없음 (${totals.unpricedCallCount}/${totals.calls} 호출)`;
  }

  return `$${totals.costReportedUsd.toFixed(4)} · ${reference}`;
}
