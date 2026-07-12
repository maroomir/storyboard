import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  SeedProjectUseCase,
  type ISeedProjectRepository
} from "@/application/project/seedProjectUseCase"
import { PrepareSeedSyncUseCase } from "@/application/project/prepareSeedSyncUseCase"
import { parseProjectJson } from "@/files/projectJson"

function seed(): never {
  return {
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
}

function repository(): ISeedProjectRepository {
  return {
    readSeedFile: vi.fn(),
    inspectCreateTarget: vi.fn(async () => ({ hasMetadata: true, hasProject: false })),
    findExistingRelativePaths: vi.fn(async () => ["character/hero.card"]),
    writeCreatedProject: vi.fn(),
    loadSyncSource: vi.fn(async () => ({
      existingRelativePaths: ["character/hero.card", "character/old.card"],
      existingContentByRelativePath: new Map([["character/hero.card", "different"]])
    })),
    writeSyncedProject: vi.fn(),
    readWorkspaceContent: vi.fn(),
    writeSeedFile: vi.fn()
  }
}

function useCase(storage: ISeedProjectRepository): SeedProjectUseCase {
  return new SeedProjectUseCase(
    { error: vi.fn(), info: vi.fn(), show: vi.fn(), warn: vi.fn() } as never,
    new PrepareSeedSyncUseCase(),
    storage
  )
}

describe("SeedProjectUseCase", () => {
  it("prepares creation from storage state and persists the approved plan", async () => {
    const storage = repository()
    const root = vscode.Uri.file("/workspace")
    const prepared = await useCase(storage).prepareCreate(root, seed())

    expect(prepared).toEqual(
      expect.objectContaining({
        existingRelativePaths: ["character/hero.card"],
        hasMetadata: true,
        hasProject: false
      })
    )

    await useCase(storage).createProject(root, seed(), prepared.plan)
    expect(storage.writeCreatedProject).toHaveBeenCalledWith(
      root,
      expect.anything(),
      prepared.plan,
      expect.anything()
    )
  })

  it("combines storage state with the sync policy before writing", async () => {
    const storage = repository()
    const root = vscode.Uri.file("/workspace")
    const prepared = await useCase(storage).prepareSync(root, seed())

    expect(prepared.deletions).toEqual(["character/old.card"])
    expect(prepared.contentConflicts).toEqual(["character/hero.card"])

    await useCase(storage).syncProject(root, prepared)
    expect(storage.writeSyncedProject).toHaveBeenCalledWith(
      root,
      prepared.plan,
      prepared.deletions,
      expect.anything()
    )
  })
})
