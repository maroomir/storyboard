import { novelStageNames, type NovelStageName } from '@storyboard/story-model/contracts';

import type { RunSnapshot } from '@/shared/dto';

export type StageState = 'done' | 'current' | 'waiting';

export interface StageRailItem {
  readonly stage: NovelStageName;
  readonly state: StageState;
}

// The rail shows the novel run's seven stages. A resumable run that is not running shows what the
// earlier run finished, so the author sees where "resume" will pick up.
export function stageRail(snapshot: RunSnapshot): StageRailItem[] {
  const isNovelRun = snapshot.status !== 'idle' && snapshot.kind === 'novel';
  const done = new Set<NovelStageName>(
    isNovelRun ? snapshot.completedStages : (snapshot.resumable?.completedStages ?? []),
  );
  const current = isNovelRun ? snapshot.currentStage : undefined;

  return novelStageNames.map((stage) => ({
    stage,
    state: stage === current ? 'current' : done.has(stage) ? 'done' : 'waiting',
  }));
}

export function budgetProgress(snapshot: RunSnapshot): number | undefined {
  if (snapshot.budgetUsd <= 0) {
    return undefined;
  }

  return Math.min(1, snapshot.spentUsd / snapshot.budgetUsd);
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount >= 10 ? 1 : 2)}`;
}
