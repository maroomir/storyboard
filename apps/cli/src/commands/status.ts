import type { WorkspaceNextStep, WorkspaceStatus } from '@storyboard/story-app';
import { contractFieldLabels } from '@storyboard/story-model';

import type { CommandHandler } from './outcome';

// 엔진은 어느 단계가 열려 있는지만 말한다. 그 단계를 여는 명령은 이 표가 갖는다 — 대화형 화면의
// 홈도 같은 표를 읽는다.
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

function describeMissingContract(status: WorkspaceStatus): string {
  return status.project.missingContract.map((key) => contractFieldLabels[key]).join('·');
}

function describeDrafts({ drafts }: WorkspaceStatus): string {
  const notes = [
    ...(drafts.stale > 0 ? [`카드보다 오래됨 ${drafts.stale}`] : []),
    ...(drafts.missing > 0 ? [`없음 ${drafts.missing}`] : []),
    ...(drafts.withWarnings > 0 ? [`경고 남음 ${drafts.withWarnings}`] : []),
  ];

  return `${drafts.ready + drafts.stale}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

function describeManuscript({ manuscript }: WorkspaceStatus): string {
  if (!manuscript.isAssembled) {
    return '조립 전';
  }

  return [
    manuscript.isStale ? '조립됨 (초안보다 오래됨)' : '조립됨',
    manuscript.isReviewed ? '검사함' : '검사 전',
  ].join(' · ');
}

export const showStatus: CommandHandler = async ({ container }) => {
  const status = await container.describeWorkspace();
  const command = nextStepCommands[status.nextStep];
  const reason = describeNextStep(status);

  return {
    ok: true,
    message: [
      status.project.name,
      `계약      ${status.project.missingContract.length === 0 ? '채워짐' : `${describeMissingContract(status)} 비어 있음`}`,
      `아웃라인  ${status.outline.hasChapterPlan ? '있음' : '없음'}`,
      `카드      인물 ${status.cards.characters} · 배경 ${status.cards.backgrounds} · 서술자 ${status.cards.narrators}`,
      `씬        ${status.scenes.total}`,
      `초안      ${describeDrafts(status)}`,
      `정전      미승격 후보 ${status.canon.pendingFacts}건`,
      `원고      ${describeManuscript(status)}`,
      '',
      command === undefined ? `다음      ${reason}` : `다음      storyboard ${command} — ${reason}`,
    ].join('\n'),
    data: { ...status, next: { step: status.nextStep, command: command ?? null, reason } },
  };
};
