import type { ChapterPlan, OutlineBrief } from '@storyboard/story-model';

// A plan whose chapter count is not the contract's never runs. A kept plan would be paid for at a
// length the person moved on from; a plan the model just returned would be saved and refuse every
// later run for a mismatch the person never made, so it is sent back before it is written.
export function refuseChapterCountMismatch(
  brief: OutlineBrief,
  plan: ChapterPlan,
  planSource: 'kept' | 'generated',
): void {
  if (brief.chapterCount === undefined) {
    return;
  }

  const planChapterCount = plan.acts.reduce((count, act) => count + act.chapters.length, 0);

  if (brief.chapterCount === planChapterCount) {
    return;
  }

  const contractCount = `계약은 ${brief.chapterCount}장인데`;
  throw new Error(
    planSource === 'kept'
      ? `${contractCount} 장 계획(outline/chapters.yaml)은 ${planChapterCount}장입니다. 계약의 장 수를 계획에 맞추거나, 계획을 새로 만들려면 outline/chapters.yaml 을 지우고 다시 돌리세요.`
      : `${contractCount} 모델이 만든 장 계획은 ${planChapterCount}장입니다. 계획은 저장하지 않았습니다. 다시 돌리거나 계약의 장 수를 바꾸세요.`,
  );
}
