import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { CardParseError, parseCard, serializeCard } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';
const cardsFixtureDirectory = fileURLToPath(new URL("../../../../../../packages/story-format/test/fixtures/cards/", import.meta.url))

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

  it("round-trips character aliases through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      aliases: ["만재", "재"]
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("character")
    if (reparsed.type === "character") {
      expect(reparsed.aliases).toEqual(["만재", "재"])
    }
  })

  it("round-trips background aliases through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "location",
      id: "school",
      name: "학교 정문",
      aliases: ["학교", "교문"],
      locationKind: "place",
      description: [],
      characterIds: [],
      tags: []
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("location")
    if (reparsed.type === "location") {
      expect(reparsed.aliases).toEqual(["학교", "교문"])
    }
  })

  it("round-trips a character desire field through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      desire: ["라이벌을 이기고 싶다", "인정받고 싶다"]
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("character")
    if (reparsed.type === "character") {
      expect(reparsed.desire).toEqual(["라이벌을 이기고 싶다", "인정받고 싶다"])
    }
  })

  it("round-trips background time, weather, and senses through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "location",
      id: "school",
      name: "학교 정문",
      locationKind: "place",
      description: [],
      characterIds: [],
      tags: [],
      time: "아침",
      weather: "맑음",
      senses: ["종소리", "잔디 냄새"]
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("location")
    if (reparsed.type === "location") {
      expect(reparsed.time).toBe("아침")
      expect(reparsed.weather).toBe("맑음")
      expect(reparsed.senses).toEqual(["종소리", "잔디 냄새"])
    }
  })

  it("preserves AI-managed fields through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      attributes: { age: 18 },
      traits: ["허세 섞인 단언"],
      relations: [{ target: "eunha", type: "라이벌" }],
      arc: [{ stage: "발단", summary: "첫 등장", sceneRef: "01-first-meeting" }],
      recentDialogues: ["내가 누군지 아나?"]
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("character")
    if (reparsed.type === "character") {
      expect(reparsed.attributes).toEqual({ age: 18 })
      expect(reparsed.traits).toEqual(["허세 섞인 단언"])
      expect(reparsed.relations).toEqual([{ target: "eunha", type: "라이벌" }])
      expect(reparsed.arc).toEqual([{ stage: "발단", summary: "첫 등장", sceneRef: "01-first-meeting" }])
      expect(reparsed.recentDialogues).toEqual(["내가 누군지 아나?"])
    }
  })

  it("round-trips a character voice field through serialize and parse", () => {
    const card: StoryboardCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      description: ["허세덩어리"],
      voice: ["1인칭 허세 만연체", "자칭 세기의 철학자"]
    }

    const reparsed = parseCard(serializeCard(card))

    expect(reparsed.type).toBe("character")
    if (reparsed.type === "character") {
      expect(reparsed.voice).toEqual(["1인칭 허세 만연체", "자칭 세기의 철학자"])
    }
  })
})

function readFixtureCard(fixtureName: string): string {
  return readFileSync(join(cardsFixtureDirectory, fixtureName), "utf8")
}

describe("character role near-misses", () => {
  it("maps 'support' to the supporting cast instead of demoting to extra", () => {
    const card = parseCard(
      ["type: character", "id: junhee", "name: 준희", "role: support"].join("\n")
    )

    expect(card.type === "character" ? card.role : undefined).toBe("supporting")
  })

  it("still demotes an unknown role to extra", () => {
    const card = parseCard(
      ["type: character", "id: x", "name: 엑스", "role: hero"].join("\n")
    )

    expect(card.type === "character" ? card.role : undefined).toBe("extra")
  })
})
