import type { StudioCardStage, StudioReviewState, StudioStage, StudioTarget } from './types';

const millisecondsPerDay = 86_400_000;

export function stageTitle(target: StudioTarget, stage?: StudioStage): string {
  if (!stage) {
    return targetTitle(target);
  }

  if (stage.kind === 'card') {
    return `${cardKindLabel(stage.cardKind)} · ${stage.name}`;
  }

  const order = stage.sceneStem.split('-')[0];
  return `씬 ${order} · ${stage.title ?? stage.sceneStem}`;
}

// NOTE: mirrors the host's rule — a scene entity spans the seed card and its draft, and whichever
// file the author has open is the one a proposal may rewrite.
export function editTargetFile(target: StudioTarget): string | undefined {
  const entity = target.entity;

  if (!entity) {
    return undefined;
  }

  switch (entity.kind) {
    case 'character':
    case 'background':
      return `${entity.kind}/${entity.key}.card`;
    case 'scene':
      return target.kind === 'scene' ? `scene/${entity.key}.card` : `draft/${entity.key}.md`;
    case 'project':
      return undefined;
  }
}

export function stageFacts(stage?: StudioStage, now: Date = new Date()): readonly string[] {
  if (!stage) {
    return [];
  }

  if (stage.kind === 'card') {
    return cardStageFacts(stage);
  }

  if (stage.draftUpdatedAt === undefined) {
    return ['초안 없음'];
  }

  const facts: string[] = [];

  if (stage.draftLength !== undefined) {
    facts.push(`${stage.draftLength.toLocaleString()}자`);
  }

  facts.push(stage.draftRevision === undefined ? '초안' : `초안 v${stage.draftRevision}`);

  const updatedLabel = formatRelativeDay(stage.draftUpdatedAt, now);
  if (updatedLabel.length > 0) {
    facts.push(updatedLabel);
  }

  facts.push(reviewLabel(stage.review));

  return facts;
}

export function formatRelativeDay(isoDate: string, now: Date = new Date()): string {
  const updated = new Date(isoDate);

  if (Number.isNaN(updated.getTime())) {
    return '';
  }

  const elapsedDays = calendarDayDifference(now, updated);

  if (elapsedDays <= 0) {
    return '오늘';
  }

  return elapsedDays === 1 ? '어제' : `${elapsedDays}일 전`;
}

function cardKindLabel(cardKind: StudioCardStage['cardKind']): string {
  return cardKind === 'character' ? '인물' : '배경';
}

function cardStageFacts(stage: StudioCardStage): readonly string[] {
  const facts: string[] = [];

  if (stage.role) {
    facts.push(characterRoleLabel(stage.role));
  }

  facts.push(
    stage.appearsInScenes.length === 0 ? '등장 씬 없음' : `등장 씬 ${stage.appearsInScenes.length}`,
  );

  if (stage.relations.length > 0) {
    facts.push(`관계 ${stage.relations.length}`);
  }

  return facts;
}

function characterRoleLabel(role: string): string {
  switch (role) {
    case 'main':
      return '주연';
    case 'supporting':
      return '조연';
    case 'extra':
      return '단역';
    default:
      return role;
  }
}

function reviewLabel(review: StudioReviewState): string {
  switch (review) {
    case 'clean':
      return '검수 통과';
    case 'issues':
      return '검수 이슈';
    case 'unreviewed':
      return '검수 전';
  }
}

function targetTitle(target: StudioTarget): string {
  switch (target.kind) {
    case 'draft':
      return `초안 · ${target.label ?? ''}`;
    case 'scene':
      return `씬 · ${target.label ?? ''}`;
    case 'character':
      return `인물 · ${target.label ?? ''}`;
    case 'background':
      return `배경 · ${target.label ?? ''}`;
    case 'project':
      return `프로젝트 · ${target.label ?? ''}`;
    case 'none':
      return '열린 대상 없음';
  }
}

function calendarDayDifference(now: Date, updated: Date): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const updatedDay = Date.UTC(updated.getFullYear(), updated.getMonth(), updated.getDate());

  return Math.round((today - updatedDay) / millisecondsPerDay);
}
