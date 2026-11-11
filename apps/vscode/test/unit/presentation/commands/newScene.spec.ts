import { describe, expect, it } from "vitest"

import { validateSceneSlugInput } from "@/presentation/commands/newSceneHelpers"

describe("newScene helpers", () => {
  it("validates scene slug input", () => {
    expect(validateSceneSlugInput("")).toMatch(/슬러그/)
    expect(validateSceneSlugInput("   ")).toMatch(/슬러그/)
    expect(validateSceneSlugInput("Bad_Slug")).toMatch(/소문자/)
    expect(validateSceneSlugInput("-no")).toMatch(/소문자|규칙/)
    expect(validateSceneSlugInput("chapter-1")).toBeUndefined()
    expect(validateSceneSlugInput("a")).toBeUndefined()
  })
})
