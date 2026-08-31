import {
  cardSchema,
  parseCard,
  parseSceneCard,
  serializeCard,
  serializeSceneCard,
} from '@storyboard/story-format';

import type { StudioPatchPayload } from '../../shared/messaging';

export type StudioPatchTarget = 'entityCard' | 'sceneCard' | 'draft';

export type StudioPatchResult =
  | { readonly ok: true; readonly text: string; readonly changedFields: readonly string[] }
  | { readonly ok: false; readonly message: string };

interface StudioCardFieldChange {
  readonly field: string;
  readonly value: string | readonly string[] | readonly Readonly<Record<string, string>>[];
}

// NOTE: id and type key the file name and the codec branch, so renaming or retyping a card belongs
// to the rename command, not to a chat patch that only rewrites the file in place.
const protectedEntityCardFields = new Set(['id', 'type']);

// NOTE: a scene card doubles as the generation contract. Narrative fields are free to edit;
// characters and location are editable too but the apply path refuses ids that do not resolve to
// real cards, so a chat fill cannot leave the pipeline pointing at nothing. grounding and the
// numeric contract fields stay closed — the pipeline computes those.
const editableSceneCardFields = new Set([
  'title',
  'summary',
  'purpose',
  'conflict',
  'twist',
  'emotionalShift',
  'endState',
  'foreshadowing',
  'mood',
  'relationStage',
  'characters',
  'location',
]);

export function applyStudioPatch(
  baseline: string,
  patch: StudioPatchPayload,
  target: StudioPatchTarget,
): StudioPatchResult {
  if (target === 'draft') {
    return patch.target === 'draft'
      ? applyDraftPatch(baseline, patch.replacements)
      : mismatch('초안에는 본문 구간 수정만 적용할 수 있습니다.');
  }

  if (patch.target !== 'card') {
    return mismatch('카드에는 필드 수정만 적용할 수 있습니다.');
  }

  return target === 'sceneCard'
    ? applySceneCardPatch(baseline, patch.changes)
    : applyEntityCardPatch(baseline, patch.changes);
}

function applyEntityCardPatch(
  baseline: string,
  changes: readonly StudioCardFieldChange[],
): StudioPatchResult {
  const blocked = changes.filter((change) => protectedEntityCardFields.has(change.field));

  if (blocked.length > 0) {
    return {
      ok: false,
      message: `${fieldList(blocked)} 필드는 대화로 바꿀 수 없습니다.`,
    };
  }

  let card: Record<string, unknown>;

  try {
    card = { ...parseCard(baseline) } as Record<string, unknown>;
  } catch {
    return { ok: false, message: '카드를 읽을 수 없어 수정을 적용하지 못했습니다.' };
  }

  const parsed = cardSchema.safeParse(mergeChanges(card, changes));

  if (!parsed.success) {
    return {
      ok: false,
      message: `수정한 카드가 형식에 맞지 않습니다: ${firstIssue(parsed.error)}`,
    };
  }

  return {
    ok: true,
    text: serializeCard(parsed.data),
    changedFields: changes.map((change) => change.field),
  };
}

function applySceneCardPatch(
  baseline: string,
  changes: readonly StudioCardFieldChange[],
): StudioPatchResult {
  const blocked = changes.filter((change) => !editableSceneCardFields.has(change.field));

  if (blocked.length > 0) {
    return {
      ok: false,
      message: `${fieldList(blocked)} 필드는 대화로 바꿀 수 없습니다. 씬 카드는 서술 필드만 고칠 수 있습니다.`,
    };
  }

  let card: Record<string, unknown>;

  try {
    card = { ...parseSceneCard(baseline) } as Record<string, unknown>;
  } catch {
    return { ok: false, message: '씬 카드를 읽을 수 없어 수정을 적용하지 못했습니다.' };
  }

  try {
    return {
      ok: true,
      text: serializeSceneCard(mergeChanges(card, changes) as never),
      changedFields: changes.map((change) => change.field),
    };
  } catch (error) {
    return { ok: false, message: `수정한 씬 카드가 형식에 맞지 않습니다: ${String(error)}` };
  }
}

function mergeChanges(
  card: Record<string, unknown>,
  changes: readonly StudioCardFieldChange[],
): Record<string, unknown> {
  const merged = { ...card };

  for (const change of changes) {
    merged[change.field] = Array.isArray(change.value) ? [...change.value] : change.value;
  }

  return merged;
}

function applyDraftPatch(
  baseline: string,
  replacements: readonly {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly oldText: string;
    readonly newText: string;
  }[],
): StudioPatchResult {
  const ordered = [...replacements].sort((left, right) => left.startOffset - right.startOffset);

  for (const [index, replacement] of ordered.entries()) {
    if (replacement.endOffset > baseline.length) {
      return { ok: false, message: '수정 범위가 본문을 벗어났습니다.' };
    }

    const previous = ordered[index - 1];

    if (previous && replacement.startOffset < previous.endOffset) {
      return { ok: false, message: '수정 범위가 서로 겹칩니다.' };
    }

    // NOTE: the anchor is what makes a drifted offset visible; without it a miscount rewrites an
    // unrelated passage that still passes every range check.
    if (baseline.slice(replacement.startOffset, replacement.endOffset) !== replacement.oldText) {
      return {
        ok: false,
        message: '고칠 구간이 본문과 일치하지 않습니다. 다시 요청해 주세요.',
      };
    }
  }

  let text = baseline;

  for (const replacement of [...ordered].reverse()) {
    text = `${text.slice(0, replacement.startOffset)}${replacement.newText}${text.slice(replacement.endOffset)}`;
  }

  return { ok: true, text, changedFields: [] };
}

function mismatch(message: string): StudioPatchResult {
  return { ok: false, message };
}

function fieldList(changes: readonly StudioCardFieldChange[]): string {
  return changes.map((change) => change.field).join(', ');
}

function firstIssue(error: { readonly issues: readonly { readonly message: string }[] }): string {
  return error.issues[0]?.message ?? '알 수 없는 오류';
}
