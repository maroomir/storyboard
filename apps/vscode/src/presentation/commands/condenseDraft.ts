import type { CondenseDraftResult } from '@storyboard/story-engine';

export const CONDENSE_PREVIEW_SCHEME: string = 'storyboard-condense';

export interface CondenseReviewLabels {
  readonly diffTitle: string;
  readonly confirmPrompt: string;
  readonly cancelLabel: string;
}

export function buildCondenseReviewLabels(
  condensed: Extract<CondenseDraftResult, { readonly ok: true }>,
): CondenseReviewLabels {
  if (condensed.kind === 'review-required') {
    return {
      diffTitle: '안전 기준 미달 · 초안 ↔ 축소 제안',
      confirmPrompt: `축소안이 안전 기준보다 짧습니다 (후보 ${condensed.candidateLength}자 / 최소 ${condensed.minimumLength}자). 검토 후 적용하시겠습니까?`,
      cancelLabel: '원본 유지',
    };
  }

  return {
    diffTitle: '초안 ↔ 축소 제안',
    confirmPrompt: '축소 결과를 적용하시겠습니까?',
    cancelLabel: '취소',
  };
}
