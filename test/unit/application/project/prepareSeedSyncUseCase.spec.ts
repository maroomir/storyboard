import { describe, expect, it } from "vitest"

import { PrepareSeedSyncUseCase } from "@/application/project/prepareSeedSyncUseCase"
import { parseProjectJson } from "@/files/projectJson"

describe("PrepareSeedSyncUseCase", () => {
  it("returns writes, changed content conflicts, and obsolete tracked files together", () => {
    const seed = {
      project: parseProjectJson(
        JSON.stringify({
          version: "1.0.0",
          id: "00000000-0000-4000-8000-000000000001",
          name: "테스트",
          format: "novel",
          language: "ko",
          createdAt: "2026-05-13T08:00:00.000Z",
          editor: { scenePrefixDigits: 2 }
        })
      ),
      characters: [{ type: "character", id: "hero", name: "주인공" }],
      backgrounds: [],
      scenes: [{ stem: "01-prologue", content: "새 본문" }]
    } as never
    const result = new PrepareSeedSyncUseCase().execute({
      seed,
      existingRelativePaths: ["character/hero.card", "character/old.card", "scene/01-prologue.txt"],
      existingContentByRelativePath: new Map([["scene/01-prologue.txt", "이전 본문"]])
    })

    expect(result.deletions).toEqual(["character/old.card"])
    expect(result.contentConflicts).toEqual(["scene/01-prologue.txt"])
    expect(result.plan.map((entry) => entry.relativePath)).toContain("character/hero.card")
  })
})
