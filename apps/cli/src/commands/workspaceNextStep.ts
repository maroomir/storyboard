import type { WorkspaceNextStep, WorkspaceStatus } from '@storyboard/story-app';
import { contractFieldLabels } from '@storyboard/story-model';

export const nextStepCommands: Readonly<Record<WorkspaceNextStep, string | undefined>> = {
  'fill-contract': 'project set',
  'generate-outline': 'outline generate',
  'seed-scenes': 'scene seed',
  'generate-drafts': 'draft generate --all',
  'assemble-manuscript': 'manuscript assemble',
  'review-manuscript': 'manuscript review',
  none: undefined,
};

export function describeNextStep(status: WorkspaceStatus): string {
  switch (status.nextStep) {
    case 'fill-contract':
      return `작품 계약의 ${describeMissingContract(status)} 이(가) 비어 있습니다`;
    case 'generate-outline':
      return '시놉시스와 챕터 계획이 아직 없습니다';
    case 'seed-scenes':
      return '챕터 계획은 있고 씬 카드가 없습니다';
    case 'generate-drafts':
      return `초안이 없거나 카드보다 오래된 씬이 ${status.drafts.missing + status.drafts.stale}개 있습니다`;
    case 'assemble-manuscript':
      return status.manuscript.isAssembled
        ? '원고가 초안보다 오래됐습니다'
        : '초안이 모두 있고 원고를 아직 조립하지 않았습니다';
    case 'review-manuscript':
      return '조립한 원고를 아직 검사하지 않았습니다';
    case 'none':
      return '원고 조립과 검사까지 끝났습니다';
  }
}

export function describeMissingContract(status: WorkspaceStatus): string {
  return status.project.missingContract.map((key) => contractFieldLabels[key]).join('·');
}

export function describeDrafts({ drafts }: WorkspaceStatus): string {
  const notes: string[] = [
    ...(drafts.stale > 0 ? [`카드보다 오래됨 ${drafts.stale}`] : []),
    ...(drafts.missing > 0 ? [`없음 ${drafts.missing}`] : []),
    ...(drafts.withWarnings > 0 ? [`경고 남음 ${drafts.withWarnings}`] : []),
  ];

  return `${drafts.ready + drafts.stale}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

export function describeManuscript({ manuscript }: WorkspaceStatus): string {
  if (!manuscript.isAssembled) {
    return '조립 전';
  }

  return [
    manuscript.isStale ? '조립됨 (초안보다 오래됨)' : '조립됨',
    manuscript.isReviewed ? '검사함' : '검사 전',
  ].join(' · ');
}
