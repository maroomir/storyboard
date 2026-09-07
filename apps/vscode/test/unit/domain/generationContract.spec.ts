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

describe("composition warnings", () => {
  it("accepts an omnibus with two episodes", () => {
    const readiness = validateGenerationContract(
      buildSetting({ composition: "omnibus", threads: { ep1: { title: "나룻배" }, ep2: { title: "등불" } } })
    )

    expect(readiness.warnings).toEqual([])
  })

  it("warns when an omnibus declares fewer than two episodes", () => {
    const readiness = validateGenerationContract(
      buildSetting({ composition: "omnibus", threads: { ep1: { title: "나룻배" } } })
    )

    expect(readiness.warnings.some((warning) => warning.includes("편을 두 개 이상"))).toBe(true)
  })

  it("warns when a frame wraps a thread that is not defined", () => {
    const readiness = validateGenerationContract(
      buildSetting({ composition: "frame", threads: { frame: { title: "화자", wraps: ["ghost"] } } })
    )

    expect(readiness.warnings.some((warning) => warning.includes("정의되지 않은 줄기"))).toBe(true)
  })

  it("warns when a thread wraps itself", () => {
    const readiness = validateGenerationContract(
      buildSetting({ threads: { frame: { title: "화자", wraps: ["frame"] } } })
    )

    expect(readiness.warnings.some((warning) => warning.includes("자기 자신을 감쌉니다"))).toBe(true)
  })

  it("warns when a frame composition has no wrapping thread", () => {
    const readiness = validateGenerationContract(
      buildSetting({ composition: "frame", threads: { ep1: { title: "안" } } })
    )

    expect(readiness.warnings.some((warning) => warning.includes("외화 줄기가 필요"))).toBe(true)
  })

  it("warns when alternating point of view is paired with an omniscient narrator", () => {
    const readiness = validateGenerationContract(
      buildSetting({ composition: "alternating-pov", pov: "third-omniscient" })
    )

    expect(readiness.warnings.some((warning) => warning.includes("시점 교차와 맞지 않습니다"))).toBe(true)
  })

  it("lets a thread wrap the default main thread", () => {
    const readiness = validateGenerationContract(
      buildSetting({ threads: { frame: { title: "화자", wraps: ["main"] } } })
    )

    expect(readiness.warnings).toEqual([])
  })
})

