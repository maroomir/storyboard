import { describe, expect, it } from "vitest"

import { cardSchema, isCardType } from "../../../src/shared/card"

describe("card schema", () => {
  it("parses a minimal character card", () => {
    const parsedCard = cardSchema.parse({ type: "character", id: "elia", name: "엘리아" })

    expect(parsedCard.type).toBe("character")
  })

  it("parses a minimal background card", () => {
    const parsedCard = cardSchema.parse({ type: "background", id: "school", name: "학교" })

    expect(parsedCard.type).toBe("background")
  })

  it("rejects card ids that are unsafe as file names", () => {
    const parseResult = cardSchema.safeParse({ type: "character", id: "엘리아", name: "엘리아" })

    expect(parseResult.success).toBe(false)
  })

  it("narrows supported card types", () => {
    expect(isCardType("character")).toBe(true)
    expect(isCardType("scene")).toBe(false)
  })
})
