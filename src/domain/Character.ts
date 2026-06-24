import type { CharacterCard } from "../shared/card"

export type Character = CharacterCard

export function createEmptyCharacter(id: string, name: string): Character {
  return {
    type: "character",
    id,
    name,
    role: "main",
    tags: [],
    traits: [],
    description: "",
    voice: "",
    recentDialogues: []
  }
}
