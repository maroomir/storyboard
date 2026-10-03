import { stubFileSystem } from "../../../stubs/fileSystem"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { loadCharacterRoster, loadRelationListCharacters } from "@storyboard/story-engine"
import { Uri } from "../../../stubs/vscode"

const characterFixture = readFileSync(
  fileURLToPath(new URL("../../../../../../packages/story-model/test/fixtures/cards/character.card", import.meta.url)),
  "utf8"
)

describe("loadRelationListCharacters", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("loads relations from character card files", async () => {
    const workspaceRoot = Uri.file("/workspace/story")

    vi.spyOn(vscode.workspace.fs, "readDirectory").mockResolvedValue([["elia.card", vscode.FileType.File]])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode(characterFixture))

    const characters = await loadRelationListCharacters(stubFileSystem, workspaceRoot as never)

    expect(characters).toHaveLength(1)
    expect(characters[0]).toMatchObject({
      id: "elia",
      name: "엘리아",
      role: "main",
      relations: [{ target: "jihoon", type: "친구" }]
    })
  })

  it("skips unreadable cards", async () => {
    const workspaceRoot = Uri.file("/workspace/story")

    vi.spyOn(vscode.workspace.fs, "readDirectory").mockResolvedValue([["broken.card", vscode.FileType.File]])
    vi.spyOn(vscode.workspace.fs, "readFile").mockRejectedValue(new Error("missing"))

    const characters = await loadRelationListCharacters(stubFileSystem, workspaceRoot as never)

    expect(characters).toEqual([])
  })

  it("loads character roster without relations payload", async () => {
    const workspaceRoot = Uri.file("/workspace/story")

    vi.spyOn(vscode.workspace.fs, "readDirectory").mockResolvedValue([["elia.card", vscode.FileType.File]])
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode(characterFixture))

    const roster = await loadCharacterRoster(stubFileSystem, workspaceRoot as never)

    expect(roster).toEqual([{ id: "elia", name: "엘리아", role: "main" }])
  })
})
