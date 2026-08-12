import { parseCard, serializeCard, type StoryboardCard } from '@seedkernel/wasm';

import type { WorkspacePlan } from '../workspace/workspaceChanges';
import type { ReadFile } from '../workspace/workspaceStore';

// List-valued fields the schema defines for every card, and the ones only characters carry.
const SHARED_LIST_FIELDS = ['aliases', 'tags', 'description'] as const;
const CHARACTER_LIST_FIELDS = ['traits', 'voice', 'desire'] as const;

export type SharedListField = (typeof SHARED_LIST_FIELDS)[number];
export type CharacterListField = (typeof CHARACTER_LIST_FIELDS)[number];
export type CardListField = SharedListField | CharacterListField;

export const cardListFields: readonly CardListField[] = [
  ...SHARED_LIST_FIELDS,
  ...CHARACTER_LIST_FIELDS,
];

export class CardEditError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CardEditError';
  }
}

export function isCardListField(value: string): value is CardListField {
  return (cardListFields as readonly string[]).includes(value);
}

export function planCardRename(current: ReadFile<StoryboardCard>, name: string): WorkspacePlan {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new CardEditError('이름이 비어 있습니다.');
  }

  return planFrom(current, { ...current.value, name: trimmed });
}

export function planCardListUpdate(
  current: ReadFile<StoryboardCard>,
  field: CardListField,
  values: readonly string[],
): WorkspacePlan {
  const entries = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (entries.length === 0) {
    throw new CardEditError(`${field} 값이 비어 있습니다.`);
  }

  if (isCharacterOnlyField(field) && current.value.type !== 'character') {
    throw new CardEditError(`${field}은(는) 캐릭터 카드에만 있는 항목입니다.`);
  }

  return planFrom(current, { ...current.value, [field]: entries } as StoryboardCard);
}

function isCharacterOnlyField(field: CardListField): boolean {
  return (CHARACTER_LIST_FIELDS as readonly string[]).includes(field);
}

// Serializing through the shared codec and re-parsing proves the exact bytes we are about to write
// still satisfy the schema, so a malformed card can never reach disk or a commit.
function planFrom(current: ReadFile<StoryboardCard>, updated: StoryboardCard): WorkspacePlan {
  const content = serializeCard(updated);
  parseCard(content);

  return {
    changes: {
      writes: [{ relativePath: current.relativePath, content, baselineHash: current.contentHash }],
    },
    commitMessage: `storygram: update ${current.relativePath}`,
  };
}
