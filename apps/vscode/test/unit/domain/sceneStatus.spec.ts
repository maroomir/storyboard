import { describe, expect, it } from "vitest"

import { isOutlineStale } from "@storyboard/story-model"

describe("isOutlineStale", () => {
  it("is true when the outline is newer than the scene", () => {
    expect(isOutlineStale(200, 100)).toBe(true)
  })

  it("is false when the scene is newer than or equal to the outline", () => {
    expect(isOutlineStale(100, 100)).toBe(false)
    expect(isOutlineStale(100, 200)).toBe(false)
  })

  it("is false when there is no outline", () => {
    expect(isOutlineStale(undefined, 100)).toBe(false)
  })
})
