import type { CharacterCard } from "../shared/card"

export type Character = CharacterCard

export function createEmptyCharacter(id: string, name: string): Character {
  return {
    type: "character",
    id,
    name,
    profile: `profile/${id}.png`,
    role: "main",
    attributes: {},
    tags: [],
    traits: [],
    description: "",
    relations: [],
    arc: [],
    recentDialogues: []
  }
}
