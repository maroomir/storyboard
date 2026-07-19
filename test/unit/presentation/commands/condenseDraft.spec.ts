import { describe, expect, it } from 'vitest';

import { buildCondenseReviewLabels } from '@/presentation/commands/condenseDraft';

describe('condense draft review labels', () => {
  it('warns before applying an undersized candidate', () => {
    expect(
      buildCondenseReviewLabels({
        kind: 'review-required',
        ok: true,
        text: '축소 본문',
        candidateLength: 13_773,
        minimumLength: 13_868,
      }),
    ).toEqual({
      diffTitle: '안전 기준 미달 · 초안 ↔ 축소 제안',
      confirmPrompt:
        '축소안이 안전 기준보다 짧습니다 (후보 13773자 / 최소 13868자). 검토 후 적용하시겠습니까?',
      cancelLabel: '원본 유지',
    });
  });
});
