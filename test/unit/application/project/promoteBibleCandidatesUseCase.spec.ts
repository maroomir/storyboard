import { describe, expect, it, vi } from "vitest"

import {
  PromoteBibleCandidatesUseCase,
  type IBibleCandidateRepository
} from "@/application/project/promote-bible-candidates-use-case"

describe("PromoteBibleCandidatesUseCase", () => {
  it("returns no candidates without loading the canon", async () => {
    const repository: IBibleCandidateRepository = {
      loadCanon: vi.fn(),
      loadRecords: vi.fn(async () => []),
      saveCanon: vi.fn()
    }
    const useCase = new PromoteBibleCandidatesUseCase(repository)

    const result = await useCase.prepare({} as never)

    expect(result).toEqual({ kind: "no_candidates" })
    expect(repository.loadCanon).not.toHaveBeenCalled()
  })

  it("merges selected facts as canon before saving", async () => {
    const repository: IBibleCandidateRepository = {
      loadCanon: vi.fn(async () => ({ facts: [] })),
      loadRecords: vi.fn(),
      saveCanon: vi.fn(async () => undefined)
    }
    const useCase = new PromoteBibleCandidatesUseCase(repository)
    const fact = {
      id: "character:elia:occupation",
      key: "occupation",
      sourceScene: "01-arrival",
      subject: { id: "elia", kind: "character" as const },
      value: "의사"
    }

    await useCase.promote({} as never, [fact])

    expect(repository.saveCanon).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        facts: [expect.objectContaining({ status: "canon", validFrom: "01-arrival" })]
      })
    )
  })
})
