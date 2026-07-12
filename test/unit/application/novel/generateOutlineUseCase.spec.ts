import { describe, expect, it, vi } from "vitest"

import {
  GenerateOutlineUseCase,
  type IOutlineRepository
} from "@/application/novel/generate-outline-use-case"
import { parseProjectJson } from "@/files/projectJson"

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
    const result = await new GenerateOutlineUseCase(gateway as never, repository).execute(
      {} as never,
      { overwrite: false }
    )
    expect(result).toEqual(expect.objectContaining({ kind: "missing_contract", ok: false }))
    expect(gateway.createService).not.toHaveBeenCalled()
  })

  it("saves generated synopsis and chapter plan", async () => {
    const repository: IOutlineRepository = {
      hasExisting: vi.fn(async () => false),
      loadCharacterBriefs: vi.fn(async () => []),
      loadProject: vi.fn(async () => project()),
      save: vi.fn(async () => ({}) as never)
    }
    const service = {
      generateOutlineSynopsis: vi.fn(async () => ({})),
      generateChapterPlan: vi.fn(async () => ({}))
    }
    const result = await new GenerateOutlineUseCase(
      { createService: () => service } as never,
      repository
    ).execute({} as never, { overwrite: false })
    expect(result).toEqual(expect.objectContaining({ kind: "generated", ok: true }))
    expect(repository.save).toHaveBeenCalledOnce()
  })
})
