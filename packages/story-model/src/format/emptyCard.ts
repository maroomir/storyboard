import { createEmptyBackground } from '#model/format/Background';
import { createEmptyCharacter } from '#model/format/Character';
import type { StoryboardCard } from '#model/format/card';

export function createEmptyCard(
  cardType: StoryboardCard['type'],
  id: string,
  name: string,
): StoryboardCard {
  return cardType === 'character'
    ? createEmptyCharacter(id, name)
    : createEmptyBackground(id, name);
}
