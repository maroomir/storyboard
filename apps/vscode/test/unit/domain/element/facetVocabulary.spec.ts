import { describe, expect, it } from "vitest"

import {
  cardSectionLabels,
  elementDefinitions,
  elementKinds,
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
