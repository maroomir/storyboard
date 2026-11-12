import { describe, expect, it } from "vitest"

import {
  cardSectionLabels,
  elementDefinitions,
  elementKinds,
  projectBackgroundCard,
  projectCardFacts,
  projectCharacterCard,
  projectNarratorCard,
  projectSceneCard,
  type ElementKind,
  type ElementSlugLookup,
  type Statement,
  type StatementFacetId,
  getStatementFacetRow,
  isStatementFacetId,
  isStatementFacetOf,
  isStoryStateFacetId,
  listSectionFacets,
  listStatementFacetsOf,
  promptFacetConsumers,
  statementFacetCatalog,
  storyStateFacetRows,
} from "@storyboard/story-model"

describe("statement facet vocabulary", () => {
  it("names each statement facet once and keeps the 21 the design settled on", () => {
    const ids = statementFacetCatalog.map((row) => row.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(21)
  })

  it("lets each kind carry the statements the design gave it", () => {
    expect(listStatementFacetsOf("character").map((row) => row.id)).toHaveLength(9)
    expect(listStatementFacetsOf("background").map((row) => row.id).sort()).toEqual(
      ["description", "fact", "layout", "rules", "senses", "tags", "time", "weather"],
    )
    expect(listStatementFacetsOf("narrator").map((row) => row.id)).toEqual(["description", "voice", "fact"])
    expect(listStatementFacetsOf("scene").map((row) => row.id)).toEqual([
      "purpose",
      "conflict",
      "twist",
      "emotionalShift",
      "endState",
      "foreshadowing",
    ])
  })

  it("keeps header fields, memory and derived values out of the statements", () => {
    for (const retired of ["role", "attributes", "aliases", "voiceSample", "neededCanon", "grounding"]) {
      expect(isStatementFacetId(retired)).toBe(false)
    }
    expect(isStatementFacetOf("tags", "character")).toBe(false)
  })

  it("keeps the story state vocabulary apart from the card statements", () => {
    expect(storyStateFacetRows.map((row) => row.id)).toEqual(["event", "relationShift", "reveal", "motif", "fact"])
    for (const row of storyStateFacetRows.filter((stateRow) => stateRow.id !== "fact")) {
      expect(isStatementFacetId(row.id)).toBe(false)
    }
    expect(isStoryStateFacetId("traits")).toBe(false)
  })

  it("asks for an about on every statement that names another card", () => {
    expect(getStatementFacetRow("relation").about).toBe("required")
    expect(getStatementFacetRow("speech").about).toBe("required")
    expect(getStatementFacetRow("fact").key).toBe("optional")
  })
})

describe("facet consumers", () => {
  it("fails a facet that reaches no prompt", () => {
    for (const row of statementFacetCatalog) {
      expect(row.consumers.some((consumer) => promptFacetConsumers.includes(consumer)), row.id).toBe(true)
    }
  })

  it("puts every facet in a section its kinds show", () => {
    for (const row of statementFacetCatalog) {
      expect(cardSectionLabels[row.section], row.id).toBeDefined()
      for (const kind of row.kinds) {
        expect(elementDefinitions[kind].sections, `${row.id} on ${kind}`).toContain(row.section)
      }
    }
  })

  it("leaves no section of a kind empty", () => {
    for (const kind of elementKinds) {
      for (const section of elementDefinitions[kind].sections) {
        expect(listSectionFacets(kind, section).length, `${kind} ${section}`).toBeGreaterThan(0)
      }
    }
  })

  it("keeps the facets the draft readers depend on wired to them", () => {
    expect(getStatementFacetRow("catchphrases").consumers).toContain("catchphraseLimit")
    expect(getStatementFacetRow("speech").consumers).toContain("dialoguePolish")
    expect(getStatementFacetRow("foreshadowing").consumers).toContain("manuscriptAssembly")
    for (const facetId of ["purpose", "conflict", "emotionalShift", "endState"] as const) {
      expect(getStatementFacetRow(facetId).consumers).toContain("sceneDesign")
    }
  })
})

const partnerId = "partner-uuid"
const projectionLookup: ElementSlugLookup & { nameOf: (id: string) => string | undefined } = {
  slugOf: (id) => (id === partnerId ? "partner" : undefined),
  idOf: () => partnerId,
  nameOf: () => undefined,
}

function markerOf(kind: ElementKind, facet: StatementFacetId): string {
  return `marker-${kind}-${facet}`
}

function statementFor(kind: ElementKind, facet: StatementFacetId): Statement {
  const row = getStatementFacetRow(facet)
  return {
    facet,
    value: markerOf(kind, facet),
    ...(row.about === "required" ? { about: partnerId } : {}),
    source: { origin: "author" },
  }
}

function projectCard(kind: ElementKind, statements: readonly Statement[]): unknown {
  switch (kind) {
    case "character":
      return projectCharacterCard({ header: { id: "c", slug: "c", kind, name: "C" }, statements }, projectionLookup)
    case "background":
      return projectBackgroundCard({ header: { id: "b", slug: "b", kind, name: "B" }, statements })
    case "narrator":
      return projectNarratorCard(
        { header: { id: "n", slug: "n", kind, name: "N", person: "first", knowledge: "witnessed" }, statements },
        projectionLookup,
      )
    case "scene":
      return projectSceneCard(
        { header: { id: "s", slug: "s", kind, title: "S" }, statements, beats: [] },
        { stem: "001-s", number: 1 },
        projectionLookup,
      )
  }
}

function projectStatement(kind: ElementKind, statement: Statement): unknown {
  const statements: readonly Statement[] = [statement]
  const facts: unknown = projectCardFacts([{ kind, slug: "subject", statements }], {
    sceneOrderOf: () => undefined,
    characterSlugOf: () => undefined,
  })
  return { card: projectCard(kind, statements), facts }
}

describe("facet projections", () => {
  it("carries every facet a kind declares into what the prompts read", () => {
    const unprojected = elementKinds.flatMap((kind) =>
      listStatementFacetsOf(kind).flatMap((row) => {
        const projected = JSON.stringify(projectStatement(kind, statementFor(kind, row.id)))
        return projected.includes(markerOf(kind, row.id)) ? [] : [`${kind} ${row.id}`]
      }),
    )

    expect(unprojected).toEqual([])
  })
})
