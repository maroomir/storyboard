import { describe, expect, it } from "vitest"

import { validateGenerationContract } from "@storyboard/story-engine"
import type { ProjectSetting } from '@storyboard/story-format';

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

  // project.json is hand-editable and the bot parses it without a schema, so these arrays really do
  // arrive missing. Spreading undefined used to throw and take the whole outline job down with it.
  it("survives a setting whose optional arrays were omitted", () => {
    const bare = { genre: "판타지", audience: "성인", pov: "first", targetWordCount: 120_000 }

    const readiness = validateGenerationContract(bare as never)

    expect(readiness.missing).toHaveLength(0)
    expect(readiness.warnings).toHaveLength(0)
  })
})
