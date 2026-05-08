import { describe, expect, it } from "vitest"

import {
  computeNextSceneOrderFromSceneFileNames,
  formatSceneOrderPrefix,
  validateSceneSlugInput
} from "@/commands/newSceneHelpers"

describe("newScene helpers", () => {
  it("computes next order as 1 when there are no valid scene files", () => {
    expect(computeNextSceneOrderFromSceneFileNames([])).toBe(1)
    expect(computeNextSceneOrderFromSceneFileNames(["readme.txt", "bad.txt"])).toBe(1)
  })

  it("computes next order from the maximum parsed scene order", () => {
    expect(computeNextSceneOrderFromSceneFileNames(["01-prologue.txt", "02-turn.txt"])).toBe(3)
    expect(computeNextSceneOrderFromSceneFileNames(["10-a.txt", "2-b.txt"])).toBe(11)
  })

  it("zero-pads scene order prefix using project digit count", () => {
    expect(formatSceneOrderPrefix(1, 2)).toBe("01")
    expect(formatSceneOrderPrefix(12, 3)).toBe("012")
    expect(formatSceneOrderPrefix(5, 1)).toBe("5")
  })

  it("validates scene slug input", () => {
    expect(validateSceneSlugInput("")).toMatch(/슬러그/)
    expect(validateSceneSlugInput("   ")).toMatch(/슬러그/)
    expect(validateSceneSlugInput("Bad_Slug")).toMatch(/소문자/)
    expect(validateSceneSlugInput("-no")).toMatch(/소문자|규칙/)
    expect(validateSceneSlugInput("chapter-1")).toBeUndefined()
    expect(validateSceneSlugInput("a")).toBeUndefined()
  })
})
