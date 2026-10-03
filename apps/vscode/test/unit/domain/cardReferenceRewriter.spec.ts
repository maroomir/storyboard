import { describe, expect, it } from "vitest"

import { renameCardIdInBackgroundCard, renameCardIdInCharacterCard, rewriteCardIdReferences, setCardId } from '@storyboard/story-model';
import type { BackgroundCard, CharacterCard } from '@storyboard/story-model';
const hero: CharacterCard = {
  type: "character",
  id: "hero",
  name: "주인공",
  relations: [{ target: "ally", type: "friend" }]
}

const background: BackgroundCard = {
  type: "location",
  id: "town",
  name: "마을",
  locationKind: "place",
  characterIds: ["hero", "ally"],
  tags: [],
  description: []
}

describe("cardReferenceRewriter", () => {
  it("setCardId updates character id and default profile path", () => {
    const card: CharacterCard = {
      ...hero,
      profile: "profile/hero.png"
    }

    expect(setCardId(card, "protagonist")).toEqual({
      ...card,
      id: "protagonist",
      profile: "profile/protagonist.png"
    })
  })

  it("setCardId leaves custom profile paths unchanged", () => {
    const card: CharacterCard = {
      ...hero,
      profile: "profile/custom.png"
    }

    expect(setCardId(card, "protagonist")).toEqual({
      ...card,
      id: "protagonist"
    })
  })

  it("renameCardIdInCharacterCard updates relation targets", () => {
    expect(renameCardIdInCharacterCard(hero, "ally", "companion")).toEqual({
      ...hero,
      relations: [{ target: "companion", type: "friend" }]
    })
  })

  it("renameCardIdInCharacterCard is a no-op when relations are absent or unchanged", () => {
    const withoutRelations: CharacterCard = { type: "character", id: "solo", name: "Solo" }

    expect(renameCardIdInCharacterCard(withoutRelations, "solo", "new-solo")).toBe(withoutRelations)
    expect(renameCardIdInCharacterCard(hero, "missing", "other")).toBe(hero)
    expect(renameCardIdInCharacterCard(hero, "ally", "ally")).toBe(hero)
  })

  it("renameCardIdInBackgroundCard updates characterIds", () => {
    expect(renameCardIdInBackgroundCard(background, "ally", "companion")).toEqual({
      ...background,
      characterIds: ["hero", "companion"]
    })
  })

  it("renameCardIdInBackgroundCard is a no-op when the id is not referenced", () => {
    expect(renameCardIdInBackgroundCard(background, "missing", "other")).toBe(background)
    expect(renameCardIdInBackgroundCard(background, "hero", "hero")).toBe(background)
  })

  it("rewriteCardIdReferences dispatches by card type", () => {
    expect(rewriteCardIdReferences(hero, "ally", "companion")).toEqual(
      renameCardIdInCharacterCard(hero, "ally", "companion")
    )
    expect(rewriteCardIdReferences(background, "hero", "protagonist")).toEqual(
      renameCardIdInBackgroundCard(background, "hero", "protagonist")
    )
  })
})
