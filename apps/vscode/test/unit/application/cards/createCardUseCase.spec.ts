import { describe, expect, it, vi } from "vitest"

import {
  CreateCardUseCase,
  type ICardWriterRepository
} from "@storyboard/story-engine"
import { createTestRepositories } from "@storyboard/story-engine/testing"

function createUseCase(takenIds: readonly string[]): {
  readonly useCase: CreateCardUseCase
  readonly repository: ICardWriterRepository
} {
  const repository: ICardWriterRepository = {
    exists: vi.fn(async (_root, _type, id) => takenIds.includes(id)),
    write: vi.fn(async () => ({}) as never)
  }

  return { useCase: new CreateCardUseCase(createTestRepositories({ cardWriter: repository })), repository }
}

const buildCard = (id: string): never => ({ type: "character", id, name: "주인공" }) as never

describe("CreateCardUseCase", () => {
  it("adds numeric suffixes until a card ID is available", async () => {
    const { useCase } = createUseCase(["hero", "hero-2"])

    const result = await useCase.execute({
      workspaceRoot: {} as never,
      cardType: "character",
      id: "hero",
      whenIdIsTaken: "number-it",
      buildCard
    })

    expect(result).toMatchObject({ ok: true, id: "hero-3" })
  })

  it("starts from the fallback ID when the suggestion is the placeholder", async () => {
    const { useCase } = createUseCase([])

    const result = await useCase.execute({
      workspaceRoot: {} as never,
      cardType: "character",
      id: "new-card",
      fallbackId: "character",
      whenIdIsTaken: "number-it",
      buildCard
    })

    expect(result).toMatchObject({ ok: true, id: "character" })
  })

  it("refuses a taken ID without writing", async () => {
    const { useCase, repository } = createUseCase(["library"])

    const result = await useCase.execute({
      workspaceRoot: {} as never,
      cardType: "location",
      id: "library",
      whenIdIsTaken: "refuse",
      buildCard
    })

    expect(result).toEqual({ ok: false, kind: "id-taken", id: "library" })
    expect(repository.write).not.toHaveBeenCalled()
  })

  it("writes the card it builds for the chosen ID", async () => {
    const { useCase, repository } = createUseCase([])

    await useCase.execute({
      workspaceRoot: {} as never,
      cardType: "character",
      id: "hana",
      whenIdIsTaken: "refuse",
      buildCard
    })

    expect(repository.write).toHaveBeenCalledWith(expect.anything(), { type: "character", id: "hana", name: "주인공" })
  })
})
