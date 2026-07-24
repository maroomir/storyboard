import { describe, expect, it } from "vitest"

import {
  buildCardRecommendations,
  normalizeRecommendationKey,
  type CardRecommendationAiService
} from "@/infrastructure/ai/cardRecommendationBuilder"
import type { RecommendedEntity } from '@storyboard/story-ai';

function aiServiceFor(responses: Record<string, readonly RecommendedEntity[]>): CardRecommendationAiService {
  return {
    extractCardRecommendations: async (body) => [...(responses[body] ?? [])]
  }
}

describe("normalizeRecommendationKey", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeRecommendationKey("  Anna   Lee ")).toBe("anna lee")
  })
})

describe("buildCardRecommendations", () => {
  it("returns nothing when there are no sources", async () => {
    const result = await buildCardRecommendations({
      category: "character",
      sources: [],
      existingNames: [],
      aiService: aiServiceFor({})
    })

    expect(result).toEqual([])
  })

  it("excludes entities already present by name or alias", async () => {
    const aiService = aiServiceFor({
      본문: [
        { name: "민준", role: "supporting", description: "편의점 점원" },
        { name: "엘리아", description: "주인공" }
      ]
    })

    const result = await buildCardRecommendations({
      category: "character",
      sources: [{ sceneStem: "01", text: "본문" }],
      existingNames: ["엘리아", "엘"],
      aiService
    })

    expect(result).toEqual([
      { name: "민준", role: "supporting", description: "편의점 점원", sourceScenes: ["01"] }
    ])
  })

  it("dedupes the same entity across sources and merges source scenes", async () => {
    const aiService = aiServiceFor({
      a: [{ name: "Anna" }],
      b: [{ name: "anna" }]
    })

    const result = await buildCardRecommendations({
      category: "character",
      sources: [
        { sceneStem: "01", text: "a" },
        { sceneStem: "02", text: "b" }
      ],
      existingNames: [],
      aiService
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.sourceScenes).toEqual(["01", "02"])
  })

  it("matches existing names case- and whitespace-insensitively", async () => {
    const aiService = aiServiceFor({ a: [{ name: "anna" }] })

    const result = await buildCardRecommendations({
      category: "character",
      sources: [{ sceneStem: "01", text: "a" }],
      existingNames: ["  Anna "],
      aiService
    })

    expect(result).toEqual([])
  })

  it("sorts recommendations by Korean locale", async () => {
    const aiService = aiServiceFor({ x: [{ name: "지훈" }, { name: "민준" }] })

    const result = await buildCardRecommendations({
      category: "character",
      sources: [{ sceneStem: "01", text: "x" }],
      existingNames: [],
      aiService
    })

    expect(result.map((recommendation) => recommendation.name)).toEqual(["민준", "지훈"])
  })

  it("forwards category and existing names to the AI service", async () => {
    let captured: { body: string; category: string; known: readonly string[] } | undefined
    const aiService: CardRecommendationAiService = {
      extractCardRecommendations: async (body, category, knownNames) => {
        captured = { body, category, known: knownNames }
        return []
      }
    }

    await buildCardRecommendations({
      category: "background",
      sources: [{ sceneStem: "01", text: "장면 본문" }],
      existingNames: ["학교"],
      aiService
    })

    expect(captured).toMatchObject({ body: "장면 본문", category: "background", known: ["학교"] })
  })
})
