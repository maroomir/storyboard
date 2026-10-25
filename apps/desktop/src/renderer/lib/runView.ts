import { novelStageNames, type NovelStageName } from '@storyboard/story-model/contracts';

import type { RunSnapshot } from '@/shared/dto';

export type StageState = 'done' | 'current' | 'waiting';

export interface StageRailItem {
  readonly stage: NovelStageName;
  readonly state: StageState;
}

export function stageRail(snapshot: RunSnapshot): StageRailItem[] {
  const isNovelRun: boolean = snapshot.status !== 'idle' && snapshot.kind === 'novel';
  const done: Set<NovelStageName> = new Set<NovelStageName>(
    isNovelRun ? snapshot.completedStages : (snapshot.resumable?.completedStages ?? []),
  );
  const current: NovelStageName | undefined = isNovelRun ? snapshot.currentStage : undefined;

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
