import { describe, expect, it } from "vitest"

import { projectCardFacts, type CardFactLookup, type Statement } from "@storyboard/story-model"

const author: Statement["source"] = { origin: "author" }

const lookup: CardFactLookup = {
  sceneOrderOf: (sceneId) => ({ "scene-a": 3, "scene-b": 7 })[sceneId],
  characterSlugOf: (characterId) => ({ "uuid-hana": "hana" })[characterId]
}

describe("projectCardFacts", () => {
  it("turns the fact statements of character and background cards into prompt facts", () => {
    const bible = projectCardFacts(
      [
        {
          kind: "character",
          slug: "elia",
          statements: [
            { facet: "traits", value: "고집이 세다", source: author },
            { facet: "fact", key: "팔", value: "의수", since: "scene-a", until: "scene-b", source: author }
          ]
        },
        { kind: "background", slug: "harbor", statements: [{ facet: "fact", value: "만조에 문이 열린다", source: author }] },
        { kind: "narrator", slug: "wide", statements: [{ facet: "fact", value: "버려진다", source: author }] }
      ],
      lookup
    )

    expect(bible.facts).toEqual([
      {
        id: "character:elia:1",
        subject: { kind: "character", id: "elia" },
        key: "팔",
        value: "의수",
        status: "canon",
        validFrom: 3,
        validUntil: 7
      },
      {
        id: "background:harbor:0",
        subject: { kind: "background", id: "harbor" },
        key: "fact",
        value: "만조에 문이 열린다",
        status: "canon"
      }
    ])
  })

  it("names who knows a fact by slug and starts the reveal at the first scene when none is written", () => {
    const [fact] = projectCardFacts(
      [
        {
          kind: "character",
          slug: "elia",
          statements: [{ facet: "fact", value: "왕족이다", knownBy: ["uuid-hana", "uuid-ghost"], source: author }]
        }
      ],
      lookup
    ).facts

    expect(fact?.revealFrom).toEqual({ scene: 1, knownBy: ["hana"] })
  })

  it("drops a bound whose scene is not in the structure", () => {
    const [fact] = projectCardFacts(
      [{ kind: "character", slug: "elia", statements: [{ facet: "fact", value: "떠났다", since: "scene-gone", source: author }] }],
      lookup
    ).facts

    expect(fact?.validFrom).toBeUndefined()
  })
})
