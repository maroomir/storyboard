import { describe, expect, it } from "vitest"

import { cardSchema, isCardType } from "@/shared/card"

describe("card schema", () => {
  it("parses a minimal character card", () => {
    const parsedCard = cardSchema.parse({ type: "character", id: "elia", name: "엘리아" })

    expect(parsedCard.type).toBe("character")
  })

  it("parses a minimal location background card", () => {
    const parsedCard = cardSchema.parse({ type: "location", id: "school", name: "학교" })

    expect(parsedCard.type).toBe("location")
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
