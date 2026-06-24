import { describe, expect, it } from "vitest"

import {
  renameCardIdInBackgroundCard,
  rewriteCardIdReferences,
  setCardId
} from "@/core/cardReferenceRewriter"
import type { BackgroundCard, CharacterCard } from "@/shared/card"

const hero: CharacterCard = {
  type: "character",
  id: "hero",
  name: "주인공"
}

const background: BackgroundCard = {
  type: "location",
  id: "town",
  name: "마을",
  characterIds: ["hero", "ally"],
  tags: [],
  description: ""
}

describe("cardReferenceRewriter", () => {
  it("setCardId updates the card id", () => {
    expect(setCardId(hero, "protagonist")).toEqual({ ...hero, id: "protagonist" })
    expect(setCardId(background, "village")).toEqual({ ...background, id: "village" })
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

  it("rewriteCardIdReferences leaves character cards unchanged and remaps backgrounds", () => {
    expect(rewriteCardIdReferences(hero, "ally", "companion")).toBe(hero)
    expect(rewriteCardIdReferences(background, "hero", "protagonist")).toEqual(
      renameCardIdInBackgroundCard(background, "hero", "protagonist")
    )
  })
})
