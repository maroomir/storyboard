import { novelStageNames, type NovelRunState, type NovelStageName } from '#model/domain/files/novelRunState';

export interface NovelRunPlan {
  readonly stages: NovelStageName[];
  readonly startChapterIndex: number;
}

export function planRemainingStages(
  state: NovelRunState | undefined,
  chapterCount: number,
): NovelRunPlan {
  const completed: Set<NovelStageName> = new Set(state?.completedStages ?? []);
  const stages: NovelStageName[] = novelStageNames.filter((stage) => !completed.has(stage));
  const startChapterIndex: number = completed.has('chapters')
    ? chapterCount
    : (state?.nextChapterIndex ?? 0);

  return { stages, startChapterIndex };
}

export function isResumable(state: NovelRunState | undefined): state is NovelRunState {
  return state !== undefined && (state.status === 'paused' || state.status === 'failed');
}
