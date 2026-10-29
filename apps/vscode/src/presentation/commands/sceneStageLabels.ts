import type { SceneGenerationPipelineStage } from '@storyboard/story-engine';

export function stageProgressLabel(stage: SceneGenerationPipelineStage): string {
  switch (stage) {
    case 'buildPersonas':
      return '페르소나 준비';
    case 'draftSkeleton':
      return '장면 뼈대 잡기';
    case 'actBeats':
      return '배우 뼈대 잡기';
    case 'polishDialogue':
      return '대사 다듬기';
    case 'attributeDialogue':
      return '대사 화자 정리';
    case 'expandSection':
      return '구간 살붙임';
    default:
      return '처리 중';
  }
}
