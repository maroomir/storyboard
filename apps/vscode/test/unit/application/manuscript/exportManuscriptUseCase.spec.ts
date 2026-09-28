import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  ExportManuscriptUseCase,
  type IManuscriptExportRepository,
  type ManuscriptExportSource
} from "@storyboard/story-engine"
import { renderManuscriptExport } from "@storyboard/story-engine"

const volumeMarkdown = ["# 제목", "", "> 인용", "**굵게** 그리고 `코드`", "- 항목"].join("\n")

function exportSource(): ManuscriptExportSource {
  return { markdown: volumeMarkdown, projectName: "테스트" }
}

function repository(
  overrides: Partial<IManuscriptExportRepository> = {}
): IManuscriptExportRepository {
  return {
    hasManuscriptVolume: vi.fn(async () => true),
    loadVolume: vi.fn(async () => exportSource()),
    saveExport: vi.fn(async () => undefined),
    ...overrides
  }
}

function useCase(storage: IManuscriptExportRepository): ExportManuscriptUseCase {
  return new ExportManuscriptUseCase({ repository: storage })
}

describe("ExportManuscriptUseCase", () => {
  it("reports a missing volume before loading it", async () => {
    const storage = repository({ hasManuscriptVolume: vi.fn(async () => false) })

    await expect(useCase(storage).loadSource(vscode.Uri.file("/workspace"))).resolves.toEqual({
      kind: "missing_volume",
      ok: false
    })
    expect(storage.loadVolume).not.toHaveBeenCalled()
  })

  it("loads the volume markdown and project name when the volume exists", async () => {
    const storage = repository()

    await expect(useCase(storage).loadSource(vscode.Uri.file("/workspace"))).resolves.toEqual({
      kind: "ready",
      ok: true,
      markdown: volumeMarkdown,
      projectName: "테스트"
    })
  })

  it("writes markdown export output unchanged from the pure renderer", async () => {
    const saveExport = vi.fn(async () => undefined)
    const storage = repository({ saveExport })
    const targetUri = vscode.Uri.file("/workspace/테스트.md")

    const result = await useCase(storage).writeExport(targetUri, volumeMarkdown, "md")

    expect(result).toEqual({ kind: "exported", ok: true, targetUri })
    expect(saveExport).toHaveBeenCalledWith(targetUri, renderManuscriptExport(volumeMarkdown, "md"))
    expect(saveExport).toHaveBeenCalledWith(targetUri, volumeMarkdown)
  })

  it("writes plain-text export output unchanged from the pure renderer", async () => {
    const saveExport = vi.fn(async () => undefined)
    const storage = repository({ saveExport })
    const targetUri = vscode.Uri.file("/workspace/테스트.txt")

    const result = await useCase(storage).writeExport(targetUri, volumeMarkdown, "txt")

    expect(result).toEqual({ kind: "exported", ok: true, targetUri })
    expect(saveExport).toHaveBeenCalledWith(
      targetUri,
      renderManuscriptExport(volumeMarkdown, "txt")
    )
  })

  it("returns failed when writing the export rejects", async () => {
    const storage = repository({
      saveExport: vi.fn(async () => {
        throw new Error("disk full")
      })
    })

    const result = await useCase(storage).writeExport(
      vscode.Uri.file("/workspace/테스트.md"),
      volumeMarkdown,
      "md"
    )

    expect(result).toEqual({ kind: "failed", message: "disk full", ok: false })
  })

  it("returns failed when loading the volume rejects", async () => {
    const storage = repository({
      loadVolume: vi.fn(async () => {
        throw new Error("read error")
      })
    })

    const result = await useCase(storage).loadSource(vscode.Uri.file("/workspace"))

    expect(result).toEqual({ kind: "failed", message: "read error", ok: false })
  })
})
