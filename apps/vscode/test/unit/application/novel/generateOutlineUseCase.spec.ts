import { describe, expect, it, vi } from "vitest"

import {
  GenerateOutlineUseCase,
  type IOutlineRepository
} from "@storyboard/story-engine"
import { parseProjectJson } from "@storyboard/story-engine"

function project(): ReturnType<typeof parseProjectJson> {
  return parseProjectJson(
    JSON.stringify({
      version: "1.0.0",
      id: "00000000-0000-4000-8000-000000000001",
      name: "테스트",
      format: "novel",
      language: "ko",
      createdAt: "2026-05-13T08:00:00.000Z",
      editor: { scenePrefixDigits: 2 },
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
            version: "1.0.0",
            id: "00000000-0000-4000-8000-000000000001",
            name: "테스트",
            format: "novel",
            language: "ko",
            createdAt: "2026-05-13T08:00:00.000Z",
            editor: { scenePrefixDigits: 2 }
          })
        )
      )
    }
    const gateway = { createService: vi.fn() }
    const result = await new GenerateOutlineUseCase({
      aiGateway: gateway as never,
      repository,
      logger: { error: () => undefined } as never
    }).execute({ workspaceRoot: {} as never, overwrite: false })
    expect(result).toEqual(expect.objectContaining({ kind: "missing_contract", ok: false }))
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("saves generated synopsis and chapter plan", async () => {
    const repository: IOutlineRepository = {
      hasExisting: vi.fn(async () => false),
      loadCharacterBriefs: vi.fn(async () => []),
      loadNarratorIds: vi.fn(async () => []),
      loadProject: vi.fn(async () => project()),
      save: vi.fn(async () => ({}) as never)
    }
    const service = {
      generateOutlineSynopsis: vi.fn(async () => ({})),
      generateChapterPlan: vi.fn(async () => ({}))
    }
    const result = await new GenerateOutlineUseCase({
      aiGateway: { createService: () => service } as never,
      repository,
      logger: { error: () => undefined } as never
    }).execute({ workspaceRoot: {} as never, overwrite: false })
    expect(result).toEqual(expect.objectContaining({ kind: "generated", ok: true }))
    expect(repository.save).toHaveBeenCalledOnce()
  })

  // 모델이 계약의 장 수를 어긴 계획은 저장하지 않는다. 저장되면 novel generate 가 매번 거부하는 작품이 된다.
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
    const result = await new GenerateOutlineUseCase({
      aiGateway: { createService: () => service } as never,
      repository,
      logger: { error: () => undefined } as never
    }).execute({ workspaceRoot: {} as never, overwrite: false })
    expect(result).toEqual({
      kind: "failed",
      ok: false,
      message: "계약은 3장인데 모델이 만든 장 계획은 1장입니다. 계획은 저장하지 않았습니다. 다시 돌리거나 계약의 장 수를 바꾸세요."
    })
    expect(repository.save).not.toHaveBeenCalled()
  })
})
