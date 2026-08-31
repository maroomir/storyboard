import { cardSchema, parseCard, serializeCard } from '@storyboard/story-format';

import type { StudioPatchPayload } from '../../shared/messaging';

export type StudioPatchResult =
  | { readonly ok: true; readonly text: string; readonly changedFields: readonly string[] }
  | { readonly ok: false; readonly message: string };

export function applyStudioPatch(baseline: string, patch: StudioPatchPayload): StudioPatchResult {
  return patch.target === 'card'
    ? applyCardPatch(baseline, patch.changes)
    : applyDraftPatch(baseline, patch.replacements);
}

function applyCardPatch(
  baseline: string,
  changes: readonly { readonly field: string; readonly value: string | readonly string[] }[],
): StudioPatchResult {
  let card: Record<string, unknown>;

  try {
    card = { ...parseCard(baseline) } as Record<string, unknown>;
  } catch {
    return { ok: false, message: '카드를 읽을 수 없어 수정을 적용하지 못했습니다.' };
  }

  const protectedFields = changes.filter((change) => isProtectedCardField(change.field));

  if (protectedFields.length > 0) {
    return {
      ok: false,
      message: `${protectedFields.map((change) => change.field).join(', ')} 필드는 대화로 바꿀 수 없습니다.`,
    };
  }

  for (const change of changes) {
    card[change.field] = Array.isArray(change.value) ? [...change.value] : change.value;
  }

  const parsed = cardSchema.safeParse(card);

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

// NOTE: id and type key the file name and the codec branch, so renaming or retyping a card belongs
// to the rename command, not to a chat patch that only rewrites the file in place.
function isProtectedCardField(field: string): boolean {
  return field === 'id' || field === 'type';
}

function applyDraftPatch(
  baseline: string,
  replacements: readonly {
    readonly startOffset: number;
    readonly endOffset: number;
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
  }

  let text = baseline;

  for (const replacement of [...ordered].reverse()) {
    text = `${text.slice(0, replacement.startOffset)}${replacement.newText}${text.slice(replacement.endOffset)}`;
  }

  return { ok: true, text, changedFields: [] };
}

function firstIssue(error: { readonly issues: readonly { readonly message: string }[] }): string {
  return error.issues[0]?.message ?? '알 수 없는 오류';
}
