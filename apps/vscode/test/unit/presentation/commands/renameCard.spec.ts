import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CommandRegistrar } from "@/bootstrap/commandRegistrar"
import { RenameBackgroundCardCommand } from "@/presentation/commands/renameBackgroundCardCommand"
import { RenameCharacterCardCommand } from "@/presentation/commands/renameCharacterCardCommand"
import { commands, FileType, window, workspace, type WorkspaceFolder } from "../../../stubs/vscode"

describe("renameCard command", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }
  const projectJsonPath = vscode.Uri.joinPath(workspaceRoot, ".storyboard", "project.json").fsPath

  let characterRenameHandler: ((uri?: vscode.Uri) => Promise<void>) | undefined
  const rename = vi.fn(async () => ({ ok: true as const, kind: "renamed" as const, fromId: "hero", toId: "protagonist", rewrittenCount: 0, unreadableFiles: [] }))
  const commandsWithCards = (): (RenameCharacterCardCommand | RenameBackgroundCardCommand)[] => [new RenameCharacterCardCommand({ cards: { rename } }), new RenameBackgroundCardCommand({ cards: { rename } })]

  beforeEach(() => {
    characterRenameHandler = undefined

    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined

    workspace.fs.stat = async (uri): Promise<{ type: FileType }> => {
      if (uri.fsPath === projectJsonPath) {
        return { type: FileType.File }
      }
      throw new Error("not found")
    }

    workspace.fs.rename = vi.fn(async () => undefined)
    workspace.applyEdit = vi.fn(async () => true)
    window.showInputBox = vi.fn(async () => "protagonist")

    vi.spyOn(commands, "registerCommand").mockImplementation((command, callback) => {
      if (command === "storyboard.character.rename") {
        characterRenameHandler = callback as (uri?: vscode.Uri) => Promise<void>
      }
      return { dispose: vi.fn() }
    })
  })

  it("renames the bundle through the card manager", async () => {
    rename.mockClear()
    new CommandRegistrar().register(commandsWithCards())

    const cardUri = vscode.Uri.file("/ws/project/character/hero.card/card.yaml")

    expect(characterRenameHandler).toBeDefined()
    await characterRenameHandler!(cardUri)

    expect(rename).toHaveBeenCalledWith({ workspaceRoot, category: "character", fromId: "hero", toId: "protagonist" })
    expect(workspace.applyEdit).not.toHaveBeenCalled()
  })

  it("carries the card's studio sessions to the new id", async () => {
    const sessionRoot = "/ws/project/.storyboard/cache/studio-sessions/character"

    workspace.fs.stat = async (uri): Promise<{ type: FileType }> => {
      if (uri.fsPath === projectJsonPath || uri.fsPath === `${sessionRoot}/hero`) {
        return { type: FileType.File }
      }
      throw new Error("not found")
    }

    new CommandRegistrar().register(commandsWithCards())
    await characterRenameHandler!(vscode.Uri.file("/ws/project/character/hero.card/card.yaml"))

    expect(workspace.fs.rename).toHaveBeenCalledOnce()

    const [source, destination] = vi.mocked(workspace.fs.rename).mock.calls[0] ?? []

    expect((source as { fsPath: string }).fsPath).toBe(`${sessionRoot}/hero`)
    expect((destination as { fsPath: string }).fsPath).toBe(`${sessionRoot}/protagonist`)
  })

  it("leaves fs.rename alone when the card has no studio sessions", async () => {
    new CommandRegistrar().register(commandsWithCards())
    await characterRenameHandler!(vscode.Uri.file("/ws/project/character/hero.card/card.yaml"))

    expect(workspace.fs.rename).not.toHaveBeenCalled()
  })
})
