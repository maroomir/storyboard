import { describe, expect, it, vi } from "vitest"

import {
  GenerateOutlineUseCase,
  type IOutlineRepository
} from "@storyboard/story-engine"
import { parseProjectJson } from "@storyboard/story-engine"
import { createTestAi, createTestHost, createTestRepositories } from "@storyboard/story-engine/testing"

function project(): ReturnType<typeof parseProjectJson> {
  return parseProjectJson(
    JSON.stringify({
      version: "2.0.0",
      id: "00000000-0000-4000-8000-000000000001",
      name: "테스트",
      format: "novel",
      language: "ko",
      createdAt: "2026-05-13T08:00:00.000Z",
      editor: {},
      setting: { genre: "fantasy", audience: "adult", pov: "third-limited", targetWordCount: 50000 }
    })
  )
}

describe("GenerateOutlineUseCase", () => {
  it("reports missing contract fields before accessing AI or storage", async () => {
    const repository: IOutlineRepository = {
      hasExisting: vi.fn(),
      loadCharacterBriefs: vi.fn(),
      loadNarratorIds: vi.fn(async () => []),
      save: vi.fn(),
      loadProject: vi.fn(async () =>
        parseProjectJson(
          JSON.stringify({
            version: "2.0.0",
            id: "00000000-0000-4000-8000-000000000001",
            name: "테스트",
            format: "novel",
            language: "ko",
            createdAt: "2026-05-13T08:00:00.000Z",
            editor: {}
          })
        )
      )
    }
    const gateway = { createService: vi.fn() }
    const result = await new GenerateOutlineUseCase(createTestHost({ logger: { error: () => undefined } as never }), createTestAi({ gateway: gateway as never }), createTestRepositories({ outline: repository })).execute({ workspaceRoot: {} as never, overwrite: false })
    expect(result).toEqual(expect.objectContaining({ kind: "missing_contract", ok: false }))
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("saves generated synopsis and chapter plan, then writes the cards its cast still lacks", async () => {
    const repository: IOutlineRepository = {
      hasExisting: vi.fn(async () => false),
      loadCharacterBriefs: vi.fn(async () => []),
      loadNarratorIds: vi.fn(async () => []),
      loadProject: vi.fn(async () => project()),
      save: vi.fn(async () => ({}) as never)
    }
    const chapterPlan = {
      version: "1.0.0",
      acts: [
        {
          id: "act-1",
          title: "1막",
          chapters: [
            {
              id: "chapter-1",
              title: "1장",
              scenes: [{ id: "harbor", title: "항구", purpose: "만난다", characters: ["hana", "jun"], foreshadowing: [] }]
            }
          ]
        }
      ]
    }
    const service = {
      generateOutlineSynopsis: vi.fn(async () => ({})),
      generateChapterPlan: vi.fn(async () => chapterPlan),
      generateOutlineCharacters: vi.fn(async () => [{ id: "hana", name: "하나", description: ["항구 사람"] }])
    }
    const novelOutline = {
      loadCharacterBriefs: vi.fn(async () => [{ id: "jun", name: "준" }]),
      loadSynopsis: vi.fn(async () => undefined)
    }
    const cardWriter = { exists: vi.fn(async () => false), write: vi.fn(async () => undefined) }
    const result = await new GenerateOutlineUseCase(
      createTestHost({ logger: { error: () => undefined } as never }),
      createTestAi({ gateway: { createService: () => service } as never }),
      createTestRepositories({ outline: repository, novelOutline: novelOutline as never, cardWriter: cardWriter as never })
    ).execute({ workspaceRoot: {} as never, overwrite: false })

    expect(result).toEqual(expect.objectContaining({ kind: "generated", ok: true }))
    expect(repository.save).toHaveBeenCalledOnce()
    expect(service.generateOutlineCharacters).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      { id: "hana", sceneTitles: ["항구"] }
    ])
    expect(cardWriter.write).toHaveBeenCalledWith({}, expect.objectContaining({ id: "hana", name: "하나" }))
  })

  it("refuses a generated chapter plan whose chapter count is not the contract's", async () => {
    const repository: IOutlineRepository = {
      hasExisting: vi.fn(async () => false),
      loadCharacterBriefs: vi.fn(async () => []),
      loadNarratorIds: vi.fn(async () => []),
      loadProject: vi.fn(async () => ({
        ...project(),
        setting: { ...project().setting, chapterCount: 3 }
      })),
      save: vi.fn(async () => ({}) as never)
    }
    const service = {
      generateOutlineSynopsis: vi.fn(async () => ({})),
      generateChapterPlan: vi.fn(async () => ({
        version: "1.0.0",
        acts: [{ title: "1막", chapters: [{ title: "1장", scenes: [] }] }]
      }))
    }
    const result = await new GenerateOutlineUseCase(createTestHost({ logger: { error: () => undefined } as never }), createTestAi({ gateway: { createService: () => service } as never }), createTestRepositories({ outline: repository })).execute({ workspaceRoot: {} as never, overwrite: false })
    expect(result).toEqual({
      kind: "failed",
      ok: false,
      message: "계약은 3장인데 모델이 만든 장 계획은 1장입니다. 계획은 저장하지 않았습니다. 다시 돌리거나 계약의 장 수를 바꾸세요."
    })
    expect(repository.save).not.toHaveBeenCalled()
  })
})
