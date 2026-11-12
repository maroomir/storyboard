import { describe, expect, it } from "vitest"

import {
  planBackgroundBundle,
  planCharacterBundle,
  planNarratorBundle,
  projectBackgroundCard,
  projectCharacterCard,
  projectNarratorCard,
  parseCard,
  serializeCard,
  type CharacterCard,
  type CharacterHeader,
  type ElementBundleContent,
  type ElementSlugLookup,
  type Statement
} from "@storyboard/story-model"

const elia = "3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44"
const sera = "7b1d0c2a-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
const school = "5a70c1d2-3e4f-4a5b-9c6d-7e8f9a0b1c2d"
const narrator = "e1f0a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b"

const lookup: ElementSlugLookup = {
  slugOf: (id) => ({ [elia]: "elia", [sera]: "sera", [school]: "school" })[id],
  idOf: (_kind, slug) => ({ elia, sera, school })[slug]
}

const studio = { origin: "studio" as const, session: "s1" }
const author = { origin: "author" as const, command: "card set" }

const eliaContent: ElementBundleContent<CharacterHeader> = {
  header: {
    id: elia,
    slug: "elia",
    kind: "character",
    name: "엘리아",
    role: "main",
    attributes: { age: 17, job: "학생" },
    aliases: ["엘리"]
  },
  statements: [
    { facet: "traits", value: "낯선 자리에서 먼저 말을 건다", source: studio },
    { facet: "traits", value: "거절당하면 웃어넘긴다", source: author },
    { facet: "catchphrases", value: "뭐 어때", source: studio },
    { facet: "relation", about: sera, value: "소꿉친구", source: studio },
    { facet: "speech", about: sera, value: "반말", source: studio },
    { facet: "arc", value: "거절을 받아들이는 법을 배운다", source: studio },
    { facet: "fact", key: "비밀", value: "마법을 쓸 수 있다", source: author }
  ]
}

describe("card projection", () => {
  it("projects a character bundle into the card the pipeline reads, references as slugs", () => {
    expect(projectCharacterCard(eliaContent, lookup)).toEqual({
      type: "character",
      id: "elia",
      name: "엘리아",
      role: "main",
      attributes: { age: 17, job: "학생" },
      aliases: ["엘리"],
      traits: ["낯선 자리에서 먼저 말을 건다", "거절당하면 웃어넘긴다"],
      catchphrases: ["뭐 어때"],
      relations: [{ target: "sera", type: "소꿉친구", speech: "반말" }],
      arc: "거절을 받아들이는 법을 배운다"
    })
  })

  it("projects a card the card codec can write and read back, so the studio can edit it", () => {
    const projected: CharacterCard = projectCharacterCard(eliaContent, lookup)

    expect(parseCard(serializeCard(projected))).toEqual(projected)
  })

  it("projects a background as a place and a narrator with its focal as a slug", () => {
    expect(
      projectBackgroundCard({
        header: { id: school, slug: "school", kind: "background", name: "학교" },
        statements: [
          { facet: "description", value: "언덕 위 오래된 학교", source: studio },
          { facet: "time", value: "방과 후", source: studio }
        ]
      })
    ).toMatchObject({ type: "location", id: "school", description: ["언덕 위 오래된 학교"], time: "방과 후", characterIds: [] })

    expect(
      projectNarratorCard(
        {
          header: { id: narrator, slug: "elia-first", kind: "narrator", name: "엘리아 시점", person: "first", knowledge: "witnessed", focal: elia },
          statements: [{ facet: "voice", value: "짧게 끊는다", source: studio }]
        },
        lookup
      )
    ).toEqual({ type: "narrator", id: "elia-first", name: "엘리아 시점", person: "first", knowledge: "witnessed", focal: "elia", voice: ["짧게 끊는다"] })
  })
})

describe("card bundle plan", () => {
  function plan(card: CharacterCard, source = studio): readonly Statement[] {
    return planCharacterBundle(card, { current: eliaContent, newId: "unused", lookup, source }).statements
  }

  it("keeps the uuid, adds new list values and removes dropped ones a non-author wrote", () => {
    const card: CharacterCard = {
      ...projectCharacterCard(eliaContent, lookup),
      traits: ["거절당하면 웃어넘긴다", "약속을 잊지 않는다"],
      catchphrases: undefined
    }
    const planned = planCharacterBundle(card, { current: eliaContent, newId: "unused", lookup, source: studio })

    expect(planned.header.id).toBe(elia)
    expect(planned.statements.filter((line) => line.facet === "traits").map((line) => line.value)).toEqual([
      "거절당하면 웃어넘긴다",
      "약속을 잊지 않는다"
    ])
    expect(planned.statements.some((line) => line.facet === "catchphrases")).toBe(false)
    expect(planned.statements).toContainEqual(eliaContent.statements[6])
  })

  it("never drops or rewrites an author line unless the author writes", () => {
    const card: CharacterCard = { ...projectCharacterCard(eliaContent, lookup), traits: [] }

    expect(plan(card).filter((line) => line.facet === "traits").map((line) => line.value)).toEqual(["거절당하면 웃어넘긴다"])
    expect(plan(card, author).some((line) => line.facet === "traits")).toBe(false)
  })

  it("turns relations into about lines and attribute keys outside the header into keyed facts", () => {
    const planned = planCharacterBundle(
      { type: "character", id: "jun", name: "준", attributes: { age: 18, gamename: "준준" }, relations: [{ target: "elia", type: "동생" }, { target: "nobody", type: "모름" }] },
      { newId: "new-id", lookup, source: studio }
    )

    expect(planned.header).toEqual({ id: "new-id", slug: "jun", kind: "character", name: "준", attributes: { age: 18 } })
    expect(planned.statements).toEqual([
      { facet: "relation", about: elia, value: "동생", source: studio },
      { facet: "fact", key: "gamename", value: "준준", source: studio }
    ])
  })

  it("writes background and narrator bundles the same way", () => {
    expect(
      planBackgroundBundle(
        { id: "school", name: "학교", description: ["언덕 위"], tags: [], time: "방과 후" },
        { newId: school, lookup, source: studio }
      ).statements.map((line) => [line.facet, line.value])
    ).toEqual([
      ["description", "언덕 위"],
      ["time", "방과 후"]
    ])
    expect(
      planNarratorBundle(
        { type: "narrator", id: "elia-first", name: "엘리아 시점", person: "first", knowledge: "witnessed", focal: "elia" },
        { newId: narrator, lookup, source: studio }
      ).header.focal
    ).toBe(elia)
  })
})
