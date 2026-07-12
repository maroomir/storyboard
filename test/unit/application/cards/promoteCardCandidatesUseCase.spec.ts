import { describe, expect, it, vi } from "vitest"

import {
  PromoteCardCandidatesUseCase,
  type ICardCandidateRepository
} from "@/application/cards/promote-card-candidates-use-case"

const candidateRecord = {
  characters: [
    {
      arc: [],
      attributes: [{ key: "occupation", value: "의사" }],
      cardId: "minseo",
      relations: []
    }
  ],
  sceneStem: "01-arrival"
}

describe("PromoteCardCandidatesUseCase", () => {
  it("filters candidates already reflected in a card", async () => {
    const repository: ICardCandidateRepository = {
      apply: vi.fn(),
      loadCards: vi.fn(
        async () => new Map([["minseo", { attributes: { occupation: "학생" }, type: "character" }]])
      ),
      loadRecords: vi.fn(async () => [candidateRecord] as never),
      prune: vi.fn()
    }
    const useCase = new PromoteCardCandidatesUseCase(repository)

    const result = await useCase.prepare({} as never)

    expect(result).toEqual({ kind: "no_new_candidates" })
  })

  it("prunes selected candidates only after at least one card is saved", async () => {
    const repository: ICardCandidateRepository = {
      apply: vi.fn(async () => 1),
      loadCards: vi.fn(),
      loadRecords: vi.fn(),
      prune: vi.fn(async () => undefined)
    }
    const useCase = new PromoteCardCandidatesUseCase(repository)
    const item = {
      cardId: "minseo",
      key: "occupation",
      kind: "attribute" as const,
      sceneStem: "01-arrival",
      value: "의사"
    }

    const result = await useCase.promote({} as never, [item])

    expect(result).toEqual({ kind: "promoted", updatedCardCount: 1 })
    expect(repository.prune).toHaveBeenCalledWith(
      expect.anything(),
      new Set(["minseo:attribute:occupation"])
    )
  })

  it("keeps candidates when every card write fails", async () => {
    const repository: ICardCandidateRepository = {
      apply: vi.fn(async () => 0),
      loadCards: vi.fn(),
      loadRecords: vi.fn(),
      prune: vi.fn()
    }
    const useCase = new PromoteCardCandidatesUseCase(repository)

    const result = await useCase.promote({} as never, [])

    expect(result).toEqual({ kind: "save_failed", updatedCardCount: 0 })
    expect(repository.prune).not.toHaveBeenCalled()
  })
})
