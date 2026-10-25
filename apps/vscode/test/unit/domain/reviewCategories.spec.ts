import { describe, expect, it } from "vitest"

import { critiqueCategories, critiqueCategoryLabels, critiqueScoring } from "@storyboard/story-model"
import { resolveAgent, reviewCategories } from "@storyboard/story-engine"

describe("review categories", () => {
  it("carries every critique category into the review list", () => {
    for (const category of critiqueCategories) {
      expect(reviewCategories, `${category} is not reviewable`).toContain(category)
    }
  })

  it("labels and scores every critique category", () => {
    for (const category of critiqueCategories) {
      expect(critiqueCategoryLabels[category]?.length, `${category} label`).toBeGreaterThan(0)
      expect(critiqueScoring.deduction[category].high, `${category} high`).toBeGreaterThan(
        critiqueScoring.deduction[category].low
      )
    }
  })

  it("routes every review category or says out loud that it does not", () => {
    for (const category of reviewCategories) {
      const expected = category === "grammar" ? undefined : expect.any(String)
      expect(resolveAgent(category), `${category} routing`).toEqual(expected)
    }
  })
})
