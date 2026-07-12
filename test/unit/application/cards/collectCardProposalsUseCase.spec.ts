import { describe, expect, it, vi } from "vitest"

import {
  CollectCardProposalsUseCase,
  type ICardCollectRepository
} from "@/application/cards/collect-card-proposals-use-case"

describe("CollectCardProposalsUseCase", () => {
  it("collects drafts and roster before requesting card proposals", async () => {
    const repository: ICardCollectRepository = {
      loadCharacterRoster: vi.fn(async () => []),
      loadDrafts: vi.fn(async () => [{ body: "엘리아가 도착했다.", sceneStem: "01-arrival" }])
    }
    const extractCardCandidatesByCharacter = vi.fn(async () => ({
      엘리아: {
        arc: undefined,
        attributes: [{ key: "occupation", value: "의사" }],
        description: [],
        desire: [],
        relations: [],
        voice: []
      }
    }))
    const service = {
      extractBackgroundFactsFromDraft: vi.fn(),
      extractCardCandidatesByCharacter,
      extractTraitsByCharacter: vi.fn(async () => ({ 엘리아: [] }))
    }
    const gateway = { createService: vi.fn(() => service) }
    const useCase = new CollectCardProposalsUseCase(gateway as never, repository)

    const result = await useCase.execute({} as never, {
      id: "elia",
      name: "엘리아",
      type: "character"
    })

    expect(result).toEqual([
      {
        id: "attribute:occupation",
        key: "occupation",
        kind: "attribute",
        sourceScenes: ["01-arrival"],
        value: "의사"
      }
    ])
    expect(repository.loadDrafts).toHaveBeenCalled()
    expect(repository.loadCharacterRoster).toHaveBeenCalled()
    expect(extractCardCandidatesByCharacter).toHaveBeenCalledOnce()
  })

  it("returns no proposals when no draft mentions the card", async () => {
    const repository: ICardCollectRepository = {
      loadCharacterRoster: vi.fn(async () => []),
      loadDrafts: vi.fn(async () => [{ body: "다른 인물만 등장한다.", sceneStem: "01-arrival" }])
    }
    const gateway = { createService: vi.fn(() => ({})) }
    const useCase = new CollectCardProposalsUseCase(gateway as never, repository)

    const result = await useCase.execute({} as never, {
      id: "elia",
      name: "엘리아",
      type: "character"
    })

    expect(result).toEqual([])
  })
})
