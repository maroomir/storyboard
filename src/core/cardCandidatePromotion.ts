import type { CharacterCard } from '../shared/card';
import type { CardCandidateRecord } from '../shared/cardCandidates';

export type CardCandidateItem =
  | {
      readonly kind: 'attribute';
      readonly cardId: string;
      readonly sceneStem: string;
      readonly key: string;
      readonly value: string;
    }
  | {
      readonly kind: 'relation';
      readonly cardId: string;
      readonly sceneStem: string;
      readonly target: string;
      readonly type: string;
    }
  | {
      readonly kind: 'arc';
      readonly cardId: string;
      readonly sceneStem: string;
      readonly stage?: string;
      readonly summary: string;
      readonly sceneRef: string;
    };

export function cardCandidateItemKey(item: CardCandidateItem): string {
  switch (item.kind) {
    case 'attribute':
      return `${item.cardId}:attribute:${item.key}`;
    case 'relation':
      return `${item.cardId}:relation:${item.target}:${item.type}`;
    case 'arc':
      return `${item.cardId}:arc:${item.sceneRef}:${item.summary}`;
  }
}

export function collectCardCandidateItems(
  records: readonly CardCandidateRecord[],
): CardCandidateItem[] {
  const byKey = new Map<string, CardCandidateItem>();

  for (const record of records) {
    for (const character of record.characters) {
      for (const attribute of character.attributes) {
        addItem(byKey, {
          kind: 'attribute',
          cardId: character.cardId,
          sceneStem: record.sceneStem,
          key: attribute.key,
          value: attribute.value,
        });
      }

      for (const relation of character.relations) {
        addItem(byKey, {
          kind: 'relation',
          cardId: character.cardId,
          sceneStem: record.sceneStem,
          target: relation.target,
          type: relation.type,
        });
      }

      for (const arc of character.arc) {
        addItem(byKey, {
          kind: 'arc',
          cardId: character.cardId,
          sceneStem: record.sceneStem,
          ...(arc.stage === undefined ? {} : { stage: arc.stage }),
          summary: arc.summary,
          sceneRef: arc.sceneRef,
        });
      }
    }
  }

  return [...byKey.values()];
}

function addItem(byKey: Map<string, CardCandidateItem>, item: CardCandidateItem): void {
  const key = cardCandidateItemKey(item);
  if (!byKey.has(key)) {
    byKey.set(key, item);
  }
}

// NOTE: A card that already carries the same fact should not be re-proposed. Attributes match by
// key only (the AI must never overwrite a user-authored value); relations by target+type; arc by
// sceneRef+summary. Unknown cards (no card found) keep every item as new.
export function isCardCandidateItemPresent(
  item: CardCandidateItem,
  card: CharacterCard | undefined,
): boolean {
  if (!card) {
    return false;
  }

  switch (item.kind) {
    case 'attribute':
      return Object.prototype.hasOwnProperty.call(card.attributes ?? {}, item.key);
    case 'relation':
      return (card.relations ?? []).some(
        (relation) => relation.target === item.target && relation.type === item.type,
      );
    case 'arc':
      return (card.arc ?? []).some(
        (arc) => arc.sceneRef === item.sceneRef && arc.summary === item.summary,
      );
  }
}

export function selectNewCardCandidateItems(
  items: readonly CardCandidateItem[],
  cardsById: ReadonlyMap<string, CharacterCard>,
): CardCandidateItem[] {
  return items.filter((item) => !isCardCandidateItemPresent(item, cardsById.get(item.cardId)));
}

export function pruneRecordByPromotedKeys(
  record: CardCandidateRecord,
  promotedKeys: ReadonlySet<string>,
): CardCandidateRecord {
  const characters = record.characters
    .map((character) => ({
      ...character,
      attributes: character.attributes.filter(
        (attribute) =>
          !promotedKeys.has(
            cardCandidateItemKey({
              kind: 'attribute',
              cardId: character.cardId,
              sceneStem: record.sceneStem,
              key: attribute.key,
              value: attribute.value,
            }),
          ),
      ),
      relations: character.relations.filter(
        (relation) =>
          !promotedKeys.has(
            cardCandidateItemKey({
              kind: 'relation',
              cardId: character.cardId,
              sceneStem: record.sceneStem,
              target: relation.target,
              type: relation.type,
            }),
          ),
      ),
      arc: character.arc.filter(
        (arc) =>
          !promotedKeys.has(
            cardCandidateItemKey({
              kind: 'arc',
              cardId: character.cardId,
              sceneStem: record.sceneStem,
              summary: arc.summary,
              sceneRef: arc.sceneRef,
            }),
          ),
      ),
    }))
    .filter(
      (character) =>
        character.attributes.length + character.relations.length + character.arc.length > 0,
    );

  return { ...record, characters };
}

export function applyCardCandidateItems(
  card: CharacterCard,
  items: readonly CardCandidateItem[],
): CharacterCard {
  const attributes = { ...(card.attributes ?? {}) };
  const relations = [...(card.relations ?? [])];
  const arc = [...(card.arc ?? [])];

  for (const item of items) {
    if (item.cardId !== card.id) {
      continue;
    }

    if (item.kind === 'attribute') {
      if (!Object.prototype.hasOwnProperty.call(attributes, item.key)) {
        attributes[item.key] = item.value;
      }
    } else if (item.kind === 'relation') {
      if (
        !relations.some(
          (relation) => relation.target === item.target && relation.type === item.type,
        )
      ) {
        relations.push({ target: item.target, type: item.type });
      }
    } else {
      if (
        !arc.some((entry) => entry.sceneRef === item.sceneRef && entry.summary === item.summary)
      ) {
        arc.push({
          stage: item.stage ?? item.sceneRef,
          summary: item.summary,
          sceneRef: item.sceneRef,
        });
      }
    }
  }

  return {
    ...card,
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...(arc.length > 0 ? { arc } : {}),
  };
}
