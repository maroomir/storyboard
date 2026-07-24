import { describe, expect, it } from "vitest"

import { CardRecommendationPrompt, coerceCardRecommendations } from '@storyboard/story-ai';

describe("coerceCardRecommendations", () => {
  it("returns empty when the parsed value is null", () => {
    expect(coerceCardRecommendations(null, "character")).toEqual([])
  })

  it("keeps valid character entries and trims fields", () => {
    const result = coerceCardRecommendations(
      [{ name: "  민준 ", role: "supporting", description: " 편의점 점원 " }],
      "character"
    )

    expect(result).toEqual([{ name: "민준", role: "supporting", description: "편의점 점원" }])
  })

  it("drops an unrecognized role for characters", () => {
    expect(coerceCardRecommendations([{ name: "민준", role: "hero" }], "character")).toEqual([{ name: "민준" }])
  })

  it("ignores role for backgrounds", () => {
    expect(coerceCardRecommendations([{ name: "학교 정문", role: "main", description: "교문" }], "background")).toEqual([
      { name: "학교 정문", description: "교문" }
    ])
  })

  it("skips non-objects and entries without a usable name", () => {
    const result = coerceCardRecommendations(
      [{ description: "이름 없음" }, "nope", null, { name: "  " }, { name: "유효" }],
      "character"
    )

    expect(result).toEqual([{ name: "유효" }])
  })
})

describe("CardRecommendationPrompt.build", () => {
  it("emits a character JSON shape with a role field", () => {
    const prompt = CardRecommendationPrompt.build("본문 내용", "character", [])

    expect(prompt.system).toContain('"role"')
    expect(prompt.user).toContain("본문 내용")
  })

  it("lists known names as exclusions when provided", () => {
    const prompt = CardRecommendationPrompt.build("본문", "background", ["학교", "교문"])

    expect(prompt.system).toContain("학교, 교문")
  })

  it("omits the exclusion line when no known names are given", () => {
    const prompt = CardRecommendationPrompt.build("본문", "character", [])

    expect(prompt.system).not.toContain("이미 카드로 등록")
  })

  it("produces a shorter system block for the xs variant", () => {
    const generic = CardRecommendationPrompt.build("본문", "character", [], "generic")
    const xs = CardRecommendationPrompt.build("본문", "character", [], "xs")

    expect(xs.system.length).toBeLessThan(generic.system.length)
  })
})
