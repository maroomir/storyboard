import { describe, expect, it } from "vitest"

import { BackgroundFactExtractionPrompt, coerceBackgroundFactExtraction } from '@storyboard/story-ai';
import { cardCollectProposalSchema } from "@storyboard/story-model"

describe("coerceBackgroundFactExtraction", () => {
  it("trims string lists and drops empty scalars", () => {
    const result = coerceBackgroundFactExtraction({
      description: ["  오래된 도서관 ", "", 42],
      senses: ["곰팡이 냄새"],
      time: "  한밤중 ",
      weather: "   ",
      characterNames: ["엘리아", ""]
    })

    expect(result.description).toEqual(["오래된 도서관"])
    expect(result.senses).toEqual(["곰팡이 냄새"])
    expect(result.time).toBe("한밤중")
    expect(result.weather).toBeUndefined()
    expect(result.characterNames).toEqual(["엘리아"])
  })

  it("returns empty extraction for null input", () => {
    expect(coerceBackgroundFactExtraction(null)).toEqual({ description: [], senses: [], characterNames: [] })
  })
})

describe("BackgroundFactExtractionPrompt", () => {
  it("includes the background name and draft body", () => {
    const prompt = BackgroundFactExtractionPrompt.build("도서관에서 만났다.", "도서관")
    expect(prompt.system).toContain("도서관")
    expect(prompt.user).toContain("도서관에서 만났다.")
  })
})

describe("cardCollectProposalSchema", () => {
  it("accepts a valid scalar proposal", () => {
    const parsed = cardCollectProposalSchema.safeParse({
      id: "scalar:time",
      sourceScenes: ["01"],
      kind: "scalar",
      field: "time",
      after: "한밤중"
    })

    expect(parsed.success).toBe(true)
  })

  it("rejects an unknown kind", () => {
    const parsed = cardCollectProposalSchema.safeParse({ id: "x", sourceScenes: [], kind: "mystery", value: "?" })
    expect(parsed.success).toBe(false)
  })
})
