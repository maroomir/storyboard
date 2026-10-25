import { computeCostUsd } from '@storyboard/story-ai';
import type { AiTaskName, UsageRecord } from '@storyboard/story-model';

export interface TaskUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TokenTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly byTask: Readonly<Partial<Record<AiTaskName, TaskUsage>>>;
  readonly costUsd: number | undefined;
  readonly unpricedCallCount: number;
  readonly unattributedCallCount: number;
}

export function summarizeUsage(records: readonly UsageRecord[]): TokenTotals {
  const byTask: Partial<Record<AiTaskName, TaskUsage>> = {};
  let inputTokens: number = 0;
  let outputTokens: number = 0;
  let cacheReadInputTokens: number = 0;
  let costTotal: number = 0;
  let unpricedCallCount: number = 0;
  let unattributedCallCount: number = 0;

  for (const record of records) {
    const recordInputTokens: number = record.usage?.inputTokens ?? 0;
    const recordOutputTokens: number = record.usage?.outputTokens ?? 0;

    inputTokens += recordInputTokens;
    outputTokens += recordOutputTokens;
    cacheReadInputTokens += record.usage?.cacheReadInputTokens ?? 0;

    const previous: TaskUsage | undefined = byTask[record.taskName];
    byTask[record.taskName] = {
      calls: (previous?.calls ?? 0) + 1,
      inputTokens: (previous?.inputTokens ?? 0) + recordInputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + recordOutputTokens,
    };

    const cost: number | undefined =
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
