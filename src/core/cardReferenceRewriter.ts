import {
  isBackgroundCard,
  type BackgroundCard,
  type StoryboardCard
} from "../shared/card"

export function setCardId<T extends StoryboardCard>(card: T, newId: string): T {
  return { ...card, id: newId }
}

export function renameCardIdInBackgroundCard(
  card: BackgroundCard,
  oldId: string,
  newId: string
): BackgroundCard {
  if (oldId === newId || !card.characterIds.includes(oldId)) {
    return card
  }

  return {
    ...card,
    characterIds: card.characterIds.map((characterId) =>
      characterId === oldId ? newId : characterId
    )
  }
}

export function rewriteCardIdReferences(
  card: StoryboardCard,
  oldId: string,
  newId: string
): StoryboardCard {
  if (oldId === newId) {
    return card
  }

  if (isBackgroundCard(card)) {
    return renameCardIdInBackgroundCard(card, oldId, newId)
  }

  return card
}
