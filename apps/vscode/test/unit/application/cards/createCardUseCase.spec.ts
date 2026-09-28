import { describe, expect, it, vi } from "vitest"

import {
  CreateCardUseCase,
  type ICardWriterRepository
} from "@storyboard/story-engine"

describe("CreateCardUseCase", () => {
  it("adds numeric suffixes until a card ID is available", async () => {
    const repository: ICardWriterRepository = {
      exists: vi.fn(async (_root, _type, id) => id === "hero" || id === "hero-2"),
      write: vi.fn()
    }
    const useCase = new CreateCardUseCase({ repository })

    const id = await useCase.deriveUniqueId({} as never, "character", "hero", "character")

    expect(id).toBe("hero-3")
  })

  it("writes a card through its repository", async () => {
    const uri = {} as never
    const repository: ICardWriterRepository = {
      exists: vi.fn(),
      write: vi.fn(async () => uri)
    }
    const useCase = new CreateCardUseCase({ repository })
    const card = { type: "location", id: "library", name: "도서관" } as never

    await expect(useCase.write({} as never, card)).resolves.toBe(uri)
    expect(repository.write).toHaveBeenCalledWith(expect.anything(), card)
  })
})
