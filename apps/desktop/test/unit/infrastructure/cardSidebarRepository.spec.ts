import { stubFileSystem } from "../../stubs/fileSystem"
import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardSidebarRepository } from "@storyboard/story-engine"

describe("CardSidebarRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists valid cards in the requested sidebar category", async () => {
    vi.spyOn(vscode.workspace.fs, "readDirectory").mockResolvedValue([
      ["elia.card", vscode.FileType.File]
    ])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
      new TextEncoder().encode("type: character\nid: elia\nname: 엘리아\nrole: main\n")
    )
    const repository = new CardSidebarRepository(stubFileSystem)

    const result = await repository.list(vscode.Uri.file("/workspace"), "character")

    expect(result).toEqual([
      expect.objectContaining({ id: "elia", name: "엘리아", role: "main", type: "character" })
    ])
  })

  it("keeps invalid cards visible as error summaries", async () => {
    vi.spyOn(vscode.workspace.fs, "readDirectory").mockResolvedValue([
      ["broken.card", vscode.FileType.File]
    ])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode("broken"))
    const repository = new CardSidebarRepository(stubFileSystem)

    const result = await repository.list(vscode.Uri.file("/workspace"), "background")

    expect(result[0]).toEqual(
      expect.objectContaining({ error: expect.any(String), type: "location" })
    )
  })
})
