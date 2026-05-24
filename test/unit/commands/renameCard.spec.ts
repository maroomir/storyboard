import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerRenameCardCommands } from "@/commands/renameCard"
import { commands, FileType, window, workspace, WorkspaceEdit, type WorkspaceFolder } from "../../stubs/vscode"

describe("renameCard command", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }
  const projectJsonPath = vscode.Uri.joinPath(workspaceRoot, ".storyboard", "project.json").fsPath

  let characterRenameHandler: ((uri?: vscode.Uri) => Promise<void>) | undefined

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

  it("uses workspace.applyEdit instead of fs.rename", async () => {
    registerRenameCardCommands()

    const cardUri = vscode.Uri.file("/ws/project/character/hero.card")

    expect(characterRenameHandler).toBeDefined()
    await characterRenameHandler!(cardUri)

    expect(workspace.applyEdit).toHaveBeenCalledOnce()
    expect(workspace.fs.rename).not.toHaveBeenCalled()

    const edit = vi.mocked(workspace.applyEdit).mock.calls[0]?.[0] as WorkspaceEdit
    const renames = edit.getRenames()

    expect(renames).toHaveLength(1)
    expect(renames[0]?.oldUri.fsPath).toBe(cardUri.fsPath)
    expect(renames[0]?.newUri.fsPath).toBe("/ws/project/character/protagonist.card")
  })
})
