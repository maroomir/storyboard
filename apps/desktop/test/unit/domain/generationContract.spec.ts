import { describe, expect, it } from "vitest"

import { validateGenerationContract } from "@/domain/generationContract"
import type { ProjectSetting } from '@seedkernel/wasm';

function buildSetting(overrides: Partial<ProjectSetting> = {}): ProjectSetting {
  return {
    genre: "성장 판타지",
    audience: "10대 후반",
    pov: "third-limited",
    targetWordCount: 120_000,
    tags: [],
    prohibitions: [],
    ...overrides
  }
}

describe("validateGenerationContract", () => {
  it("reports a complete contract as ready", () => {
    const readiness = validateGenerationContract(buildSetting())

    expect(readiness.isReady).toBe(true)
    expect(readiness.missing).toEqual([])
    expect(readiness.warnings).toEqual([])
  })

  it("treats an undefined setting as missing every required field", () => {
    const readiness = validateGenerationContract(undefined)

    expect(readiness.isReady).toBe(false)
    expect(readiness.missing).toEqual(["genre", "audience", "pov", "targetWordCount"])
  })

  it("lists individually missing fields", () => {
    const readiness = validateGenerationContract(
      buildSetting({ audience: undefined, targetWordCount: undefined })
    )

    expect(readiness.missing).toEqual(["audience", "targetWordCount"])
    expect(readiness.isReady).toBe(false)
  })

  it("treats blank string fields as missing", () => {
    const readiness = validateGenerationContract(buildSetting({ genre: "   " }))

    expect(readiness.missing).toContain("genre")
  })

  it("warns when the target word count is outside a reasonable range", () => {
    const tooSmall = validateGenerationContract(buildSetting({ targetWordCount: 100 }))
    const tooLarge = validateGenerationContract(buildSetting({ targetWordCount: 5_000_000 }))

    expect(tooSmall.warnings).toHaveLength(1)
    expect(tooLarge.warnings).toHaveLength(1)
    expect(tooSmall.isReady).toBe(false)
  })

  it("warns when a prohibition conflicts with the genre or a tag", () => {
    const readiness = validateGenerationContract(
      buildSetting({ tags: ["로맨스"], prohibitions: ["로맨스"] })
    )

    expect(readiness.warnings).toHaveLength(1)
    expect(readiness.warnings[0]).toContain("로맨스")
  })
})
