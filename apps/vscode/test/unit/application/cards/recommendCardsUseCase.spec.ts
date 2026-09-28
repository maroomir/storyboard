import { describe, expect, it, vi } from "vitest"

import {
  RecommendCardsUseCase,
  type ICardRecommendationAiGateway,
  type ICardRecommendationRepository
} from "@storyboard/story-engine"

describe("RecommendCardsUseCase", () => {
  it("reports no sources without invoking the AI provider", async () => {
    const repository: ICardRecommendationRepository = {
      load: vi.fn(async () => ({ existingNames: [], sources: [] }))
    }
    const gateway: ICardRecommendationAiGateway = { createService: vi.fn() }
    const useCase = new RecommendCardsUseCase({ aiGateway: gateway, logger: { error: vi.fn() } as never, repository })

    const result = await useCase.execute({
      category: "character",
      workspaceRoot: {} as never
    })

    expect(result).toEqual({ kind: "no_sources", ok: true })
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("returns recommendations generated from repository sources", async () => {
    const extractCardRecommendations = vi.fn(async () => [
      { description: "주인공의 동료", name: "민서", role: "friend" }
    ])
    const repository: ICardRecommendationRepository = {
      load: vi.fn(async () => ({
        existingNames: ["기존 인물"],
        sources: [{ sceneStem: "01-arrival", text: "민서가 도착했다." }]
      }))
    }
    const gateway: ICardRecommendationAiGateway = {
      createService: vi.fn(() => ({ extractCardRecommendations }))
    }
    const useCase = new RecommendCardsUseCase({ aiGateway: gateway, logger: { error: vi.fn() } as never, repository })

    const result = await useCase.execute({
      category: "character",
      workspaceRoot: {} as never
    })

    expect(result).toEqual({
      kind: "recommended",
      ok: true,
      recommendations: [
        {
          description: "주인공의 동료",
          name: "민서",
          role: "friend",
          sourceScenes: ["01-arrival"]
        }
      ]
    })
  })

  it("preserves cancellation before repository access", async () => {
    const repository: ICardRecommendationRepository = { load: vi.fn() }
    const gateway: ICardRecommendationAiGateway = { createService: vi.fn() }
    const useCase = new RecommendCardsUseCase({ aiGateway: gateway, logger: { error: vi.fn() } as never, repository })

    const result = await useCase.execute({
      category: "background",
      shouldCancel: (): boolean => true,
      workspaceRoot: {} as never
    })

    expect(result).toEqual({ kind: "cancelled", ok: false })
    expect(repository.load).not.toHaveBeenCalled()
  })
})
