import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CommandRegistrar } from "@/bootstrap/commandRegistrar"
import { RenameSceneCommand } from "@/presentation/commands/renameSceneCommand"
import { commands, FileType, window, workspace, type WorkspaceFolder } from "../../../stubs/vscode"

describe("renameScene command", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }
  const projectJsonPath = vscode.Uri.joinPath(workspaceRoot, ".storyboard", "project.json").fsPath
  const sceneUri = vscode.Uri.file("/ws/project/scene/003-night-market.card")

  let renameHandler: ((uri?: vscode.Uri) => Promise<void>) | undefined
  const renameScene = vi.fn()
  const hold = vi.fn(async (_root: unknown, _label: string, run: () => Promise<void>) => {
    await run()
    return { ok: true as const }
  })

  beforeEach(() => {
    renameHandler = undefined
    renameScene.mockReset()
    hold.mockClear()

    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined

    workspace.fs.stat = async (uri): Promise<{ type: FileType }> => {
      if (uri.fsPath === projectJsonPath) {
        return { type: FileType.File }
      }
      throw new Error("not found")
    }

    window.showInputBox = vi.fn(async () => "moon-market")
    window.showWarningMessage = vi.fn(async () => undefined)
    window.showErrorMessage = vi.fn(async () => undefined)
    window.showInformationMessage = vi.fn(async () => undefined)

    vi.spyOn(commands, "registerCommand").mockImplementation((command, callback) => {
      if (command === "storyboard.scene.rename") {
        renameHandler = callback as (uri?: vscode.Uri) => Promise<void>
      }
      return { dispose: vi.fn() }
    })
  })

  it("renames the scene through the engine while holding the workspace lock", async () => {
    renameScene.mockResolvedValue({
      ok: true,
      kind: "renamed",
      fromStem: "003-night-market",
      toStem: "003-moon-market",
      movedFiles: ["scene/003-moon-market.card"],
      rewrittenFiles: [],
    })

    new CommandRegistrar().register([new RenameSceneCommand({ drafts: { renameScene }, runGate: { hold } })])
    await renameHandler!(sceneUri)

    expect(hold).toHaveBeenCalledOnce()
    expect(renameScene).toHaveBeenCalledWith({
      workspaceRoot,
      scene: "003-night-market",
      to: "moon-market",
    })
    expect(window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ value: "night-market" }))
    expect(window.showInformationMessage).toHaveBeenCalledOnce()
  })

  it("shows the engine's refusal", async () => {
    renameScene.mockResolvedValue({ ok: false, kind: "order-changed", message: "이름 바꾸기는 번호를 그대로 둡니다." })

    new CommandRegistrar().register([new RenameSceneCommand({ drafts: { renameScene }, runGate: { hold } })])
    await renameHandler!(sceneUri)

    expect(window.showWarningMessage).toHaveBeenCalledWith("이름 바꾸기는 번호를 그대로 둡니다.")
  })

  it("refuses a card outside the scene folder without asking for a name", async () => {
    new CommandRegistrar().register([new RenameSceneCommand({ drafts: { renameScene }, runGate: { hold } })])
    await renameHandler!(vscode.Uri.file("/ws/project/character/03-night-market.card"))

    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(renameScene).not.toHaveBeenCalled()
  })
})
