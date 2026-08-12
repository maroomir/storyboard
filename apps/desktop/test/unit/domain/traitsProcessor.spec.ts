import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { parseCharacterTraitSections } from '@storyboard/story-ai';
import {
  calculateSimilarity,
  reconcileCharacterTraits,
  removeDuplicateTraits,
  removeExistingTraits,
  validateTraits
} from "@weeding/wasm"

describe("traitsProcessor", () => {
  it("calculates simple word-overlap similarity", () => {
    expect(calculateSimilarity("용감하게 앞으로 나아감", "용감하게 앞으로 나아감")).toBe(1)
    expect(calculateSimilarity("용감하게 앞으로 나아감", "조심스럽게 뒤로 물러남")).toBeLessThan(0.5)
  })

  it("removes duplicate, existing, and low-quality traits", () => {
    expect(removeDuplicateTraits(["친구를 안심시키며 또렷하게 말함", "친구를 안심시키며 또렷하게 말함"])).toEqual([
      "친구를 안심시키며 또렷하게 말함"
    ])
    expect(removeExistingTraits(["상황을 조심스럽게 관찰하고 판단함"], ["상황을 조심스럽게 관찰하고 판단함"])).toEqual([])
    expect(validateTraits(["엘리아다", "친구를 안심시키며 또렷하게 말함"])).toEqual([
      "친구를 안심시키며 또렷하게 말함"
    ])
  })

  it("processes fixture trait sections deterministically", () => {
    const response = readFileSync("test/fixtures/ai/character-traits-response.txt", "utf8")
    const extractedTraits = parseCharacterTraitSections(response, ["엘리아", "지훈"])

    expect(reconcileCharacterTraits(extractedTraits, { 지훈: ["상황을 조심스럽게 관찰하고 판단함"] })).toEqual({
      엘리아: ["활발하게 교실 앞으로 걸어 나섬", "친구를 안심시키며 또렷하게 말함"],
      지훈: ["주변 친구들의 반응을 살피며 한발 물러섬"]
    })
  })
})
