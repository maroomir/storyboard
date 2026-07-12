import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardSidebarRepository } from "@/infrastructure/persistence/repositories/cardSidebarRepository"

describe("CardSidebarRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists valid cards in the requested sidebar category", async () => {
    const cardUri = vscode.Uri.file("/workspace/character/elia.card")
    vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([cardUri])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
      new TextEncoder().encode("type: character\nid: elia\nname: 엘리아\nrole: main\n")
    )
    const repository = new CardSidebarRepository()

    const result = await repository.list(vscode.Uri.file("/workspace"), "character")

    expect(result).toEqual([
      expect.objectContaining({ id: "elia", name: "엘리아", role: "main", type: "character" })
    ])
  })

  it("keeps invalid cards visible as error summaries", async () => {
    const cardUri = vscode.Uri.file("/workspace/background/broken.card")
    vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([cardUri])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode("broken"))
    const repository = new CardSidebarRepository()

    const result = await repository.list(vscode.Uri.file("/workspace"), "background")

    expect(result[0]).toEqual(
      expect.objectContaining({ error: expect.any(String), type: "location" })
    )
  })
})
