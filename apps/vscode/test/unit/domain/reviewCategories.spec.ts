import { describe, expect, it } from "vitest"

import { critiqueCategories, critiqueCategoryLabels, critiqueScoring } from "@storyboard/story-model"
import { resolveAgent, reviewCategories } from "@storyboard/story-engine"

// 카테고리 목록·라벨·감점표·라우팅이 네 곳에 따로 있던 시절에는 새 카테고리가 라벨 없이 또는
// 라우팅 없이 들어올 수 있었다. 네 표가 같은 목록을 덮는지 여기서 본다.
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
      // grammar 는 검수자가 직접 고치므로 담당 에이전트가 없다. 나머지는 반드시 있어야 한다.
      const expected = category === "grammar" ? undefined : expect.any(String)
      expect(resolveAgent(category), `${category} routing`).toEqual(expected)
    }
  })
})
