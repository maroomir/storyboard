import type { CharacterCard } from './card';

export type Character = CharacterCard;

export function createEmptyCharacter(id: string, name: string): Character {
  return {
    type: 'character',
    id,
    name,
    profile: `profile/${id}.png`,
    role: 'main',
    attributes: {},
    tags: [],
    traits: [],
    description: [],
    voice: [],
    desire: [],
    relations: [],
    arc: [],
    recentDialogues: [],
  };
}
