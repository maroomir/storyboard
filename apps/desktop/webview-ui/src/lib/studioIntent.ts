import type { StudioActionId, StudioClarifyReason, StudioTarget } from './types';

export type { StudioClarifyReason };

export type StudioIntent =
  | { readonly kind: 'action'; readonly action: StudioActionId; readonly instruction?: string }
  | {
      readonly kind: 'clarify';
      readonly reason: StudioClarifyReason;
      readonly suggestions: readonly StudioActionId[];
    };

export function availableStudioActions(target: StudioTarget): readonly StudioActionId[] {
  const projectActions: StudioActionId[] = ['completeStory', 'buildCardsFromScenes'];
  if (target.kind === 'scene') {
    const sceneActions: StudioActionId[] = target.draftExists
      ? ['regenerate', 'applyFormat']
      : ['generate'];
    return [...projectActions, ...sceneActions];
  }

  if (target.kind === 'draft') {
    const actions: StudioActionId[] = [];

    if (target.sceneUri) {
      actions.push('regenerate');
    }

    actions.push('grammarCheck', 'continuityCheck', 'augment', 'condense');

    if (target.hasSelection) {
      actions.push('expand', 'augmentSelection');
    }

    return [...projectActions, ...actions];
  }

  if (target.kind === 'project') {
    return projectActions;
  }

  return [];
}

const recommendationLimit = 3;

export function recommendedStudioActions(target: StudioTarget): readonly StudioActionId[] {
  const available = availableStudioActions(target);

  return preferredActionOrder(target)
    .filter((action) => available.includes(action))
    .slice(0, recommendationLimit);
}

function preferredActionOrder(target: StudioTarget): readonly StudioActionId[] {
  if (target.kind === 'scene') {
    return target.draftExists
      ? ['regenerate', 'applyFormat', 'completeStory']
      : ['generate', 'buildCardsFromScenes', 'completeStory'];
  }

  if (target.kind === 'draft') {
    return target.hasSelection
      ? ['expand', 'augmentSelection', 'regenerate', 'grammarCheck', 'continuityCheck']
      : ['regenerate', 'grammarCheck', 'continuityCheck', 'augment', 'condense'];
  }

  if (target.kind === 'project') {
    return ['completeStory', 'buildCardsFromScenes'];
  }

  return [];
}

export function interpretStudioInstruction(
  instruction: string,
  target: StudioTarget,
): StudioIntent {
  const text = instruction.trim();

  if (target.kind === 'none') {
    return clarify('no-target', target);
  }

  if (target.kind === 'scene') {
    return interpretSceneInstruction(text.toLowerCase(), target);
  }

  if (target.kind === 'project') {
    if (matchesCompleteStory(text.toLowerCase())) {
      return action('completeStory');
    }
    if (matchesBuildCards(text.toLowerCase())) {
      return action('buildCardsFromScenes');
    }
    return clarify('ambiguous', target);
  }

  return interpretDraftInstruction(text, target);
}

function interpretSceneInstruction(lowered: string, target: StudioTarget): StudioIntent {
  if (matchesFormat(lowered)) {
    return target.draftExists ? action('applyFormat') : clarify('needs-draft', target);
  }

  if (matchesRegenerate(lowered) || matchesGenerate(lowered)) {
    return action(target.draftExists ? 'regenerate' : 'generate');
  }

  return clarify('ambiguous', target);
}

function interpretDraftInstruction(text: string, target: StudioTarget): StudioIntent {
  const lowered = text.toLowerCase();

  if (matchesGrammar(lowered)) {
    return action('grammarCheck');
  }

  if (matchesContinuity(lowered)) {
    return action('continuityCheck');
  }

  if (matchesCondense(lowered)) {
    return action('condense');
  }

  if (matchesExpand(lowered)) {
    return target.hasSelection ? action('expand') : clarify('needs-selection', target);
  }

  if (matchesAugment(lowered)) {
    if (mentionsSelection(lowered)) {
      return target.hasSelection ? action('augmentSelection') : clarify('needs-selection', target);
    }

    return action('augment');
  }

  if (matchesRegenerate(lowered)) {
    return target.sceneUri ? action('regenerate') : clarify('ambiguous', target);
  }

  if (text.length === 0) {
    return clarify('ambiguous', target);
  }

  return target.hasSelection ? action('editSelection', text) : clarify('needs-selection', target);
}

function action(id: StudioActionId, instruction?: string): StudioIntent {
  return instruction === undefined
    ? { kind: 'action', action: id }
    : { kind: 'action', action: id, instruction };
}

function clarify(reason: StudioClarifyReason, target: StudioTarget): StudioIntent {
  return { kind: 'clarify', reason, suggestions: availableStudioActions(target) };
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function matchesRegenerate(text: string): boolean {
  return includesAny(text, [
    'regenerate',
    '재생성',
    '다시 생성',
    '다시 써',
    '다시 쓰',
    '새로 생성',
    '새로 써',
  ]);
}

function matchesGenerate(text: string): boolean {
  return includesAny(text, ['generate', '생성', '초안 만들']);
}

function matchesFormat(text: string): boolean {
  return includesAny(text, ['format', '형식', '포맷', '문단 정리']);
}

function matchesGrammar(text: string): boolean {
  return includesAny(text, ['grammar', '문법', '맞춤법', '교정']);
}

function matchesContinuity(text: string): boolean {
  return includesAny(text, ['continuity', '연속성', '정합', '정전', 'canon', '설정 모순']);
}

function matchesExpand(text: string): boolean {
  return includesAny(text, ['expand', '확장', '늘려', '늘리', '더 길']);
}

function matchesCondense(text: string): boolean {
  return includesAny(text, [
    'condense',
    'compress',
    '초안 축소',
    '원본 축소',
    '전체 압축',
    '원본 줄이',
    '전체 줄이',
  ]);
}

function matchesAugment(text: string): boolean {
  return includesAny(text, ['augment', 'supplement', '보충', '카드']);
}

function matchesCompleteStory(text: string): boolean {
  return includesAny(text, ['complete story', 'complete', '완결', '결말', '끝까지']);
}

function matchesBuildCards(text: string): boolean {
  return includesAny(text, [
    'build cards',
    'cards from scenes',
    '카드 구성',
    '카드 만들',
    '인물 카드',
    '배경 카드',
  ]);
}

function mentionsSelection(text: string): boolean {
  return includesAny(text, ['selection', '선택']);
}
