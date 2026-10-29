import type { DraftAugmentScope } from '@storyboard/story-ai';

export const augmentPreviewScheme: string = 'storyboard-augment';

export interface AugmentLabels {
  readonly progressTitle: string;
  readonly diffTitle: string;
  readonly confirmPrompt: string;
  readonly successMessage: string;
}

export function buildAugmentLabels(
  scope: DraftAugmentScope,
  instruction: string | undefined,
): AugmentLabels {
  if (instruction) {
    return {
      progressTitle: 'Storyboard 선택 영역 편집',
      diffTitle: '초안 ↔ 수정 제안',
      confirmPrompt: '수정 결과를 적용하시겠습니까?',
      successMessage: '선택 영역을 수정했습니다.',
    };
  }

  const isSelection: boolean = scope === 'selection';

  return {
    progressTitle: isSelection ? 'Storyboard 선택 영역 보충' : 'Storyboard 초안 보충',
    diffTitle: '초안 ↔ 보충 제안',
    confirmPrompt: '보충 결과를 적용하시겠습니까?',
    successMessage: isSelection ? '선택 영역을 보충했습니다.' : '초안을 보충했습니다.',
  };
}
