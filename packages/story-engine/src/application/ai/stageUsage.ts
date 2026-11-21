import type { AiTaskName, UsageRecord } from '@storyboard/story-model';

export interface StageUsage {
  readonly stage?: string;
  readonly task: AiTaskName;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly costUsd?: number;
}

function stageTaskKeyOf(record: UsageRecord): string {
  return `${record.stage ?? ''}|${record.taskName}`;
}

function addRecordToStageUsage(current: StageUsage | undefined, record: UsageRecord): StageUsage {
  const hasEveryCost: boolean =
    record.costUsd !== undefined && (current === undefined || current.costUsd !== undefined);
  const costUsd: number = (current?.costUsd ?? 0) + (record.costUsd ?? 0);

  return {
    ...(record.stage === undefined ? {} : { stage: record.stage }),
    task: record.taskName,
    calls: (current?.calls ?? 0) + 1,
    inputTokens: (current?.inputTokens ?? 0) + (record.usage?.inputTokens ?? 0),
    outputTokens: (current?.outputTokens ?? 0) + (record.usage?.outputTokens ?? 0),
    cacheReadInputTokens:
      (current?.cacheReadInputTokens ?? 0) + (record.usage?.cacheReadInputTokens ?? 0),
    ...(hasEveryCost ? { costUsd } : {}),
  };
}

export function summarizeUsageByStage(records: readonly UsageRecord[]): readonly StageUsage[] {
  const byStageTask: Map<string, StageUsage> = new Map<string, StageUsage>();

  for (const record of records) {
    const key: string = stageTaskKeyOf(record);
    byStageTask.set(key, addRecordToStageUsage(byStageTask.get(key), record));
  }

  return [...byStageTask.values()];
}
