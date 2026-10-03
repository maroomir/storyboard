import {
  isBackgroundCard,
  type BackgroundCard,
  type CharacterCard,
  type StoryboardCard,
} from './card';

export function setCardId(card: StoryboardCard, newId: string): StoryboardCard {
  if (card.type === 'character') {
    const nextCard: CharacterCard = { ...card, id: newId };

    if (card.profile === `profile/${card.id}.png`) {
      nextCard.profile = `profile/${newId}.png`;
    }

    return nextCard;
  }

  if (isBackgroundCard(card)) {
    return { ...card, id: newId };
  }

  return card;
}

export function renameCardIdInCharacterCard(
  card: CharacterCard,
  oldId: string,
  newId: string,
): CharacterCard {
  if (oldId === newId || card.relations === undefined) {
    return card;
  }

  let changed = false;
  const relations = card.relations.map((relation) => {
    if (relation.target !== oldId) {
      return relation;
    }

    changed = true;
    return { ...relation, target: newId };
  });

  return changed ? { ...card, relations } : card;
}

export function renameCardIdInBackgroundCard(
  card: BackgroundCard,
  oldId: string,
  newId: string,
): BackgroundCard {
  if (oldId === newId || !card.characterIds.includes(oldId)) {
    return card;
  }

  return {
    ...card,
    characterIds: card.characterIds.map((characterId) =>
      characterId === oldId ? newId : characterId,
    ),
  };
}

export function rewriteCardIdReferences(
  card: StoryboardCard,
  oldId: string,
  newId: string,
): StoryboardCard {
  if (oldId === newId) {
    return card;
  }

  if (card.type === 'character') {
    return renameCardIdInCharacterCard(card, oldId, newId);
  }

  if (isBackgroundCard(card)) {
    return renameCardIdInBackgroundCard(card, oldId, newId);
  }

  return card;
}
