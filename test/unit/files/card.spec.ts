import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CardParseError, parseCard, serializeCard } from "@/files/card"

const cardsFixtureDirectory = join(process.cwd(), "test", "fixtures", "cards")

describe("card file codec", () => {
  it.each(["character.card", "background.card"])(
    "round-trips %s without changing stable YAML output",
    (fixtureName) => {
      const rawCard = readFixtureCard(fixtureName)

      const parsedCard = parseCard(rawCard)
      const serializedCard = serializeCard(parsedCard)

      expect(serializedCard).toBe(rawCard)
    }
  )

  it("wraps invalid YAML as a card parse error", () => {
    expect(() => parseCard("type: character\nid: [")).toThrow(CardParseError)

    try {
      parseCard("type: character\nid: [")
    } catch (error) {
      expect(error).toBeInstanceOf(CardParseError)
      expect((error as CardParseError).code).toBe("invalid-yaml")
    }
  })

  it("wraps schema violations as a card parse error", () => {
    expect(() => parseCard("type: character\nid: 엘리아\nname: 엘리아\n")).toThrow(CardParseError)

    try {
      parseCard("type: character\nid: 엘리아\nname: 엘리아\n")
    } catch (error) {
      expect(error).toBeInstanceOf(CardParseError)
      expect((error as CardParseError).code).toBe("invalid-card-schema")
    }
  })

  it("normalizes unknown character role values to extra on parse", () => {
    const rawCard = readFixtureCard("character.card").replace("role: main", "role: lead")

    const parsedCard = parseCard(rawCard)

    expect(parsedCard.type).toBe("character")
    if (parsedCard.type === "character") {
      expect(parsedCard.role).toBe("extra")
    }
  })
})

function readFixtureCard(fixtureName: string): string {
  return readFileSync(join(cardsFixtureDirectory, fixtureName), "utf8")
}
