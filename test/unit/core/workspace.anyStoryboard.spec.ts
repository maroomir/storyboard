import * as vscode from "vscode"
import { describe, expect, it } from "vitest"

import { anyStoryboardProjectInWorkspaceFolders } from "@/core/workspace"

describe("anyStoryboardProjectInWorkspaceFolders", () => {
  it("returns false when there are no folders", async () => {
    expect(await anyStoryboardProjectInWorkspaceFolders(undefined, async () => true)).toBe(false)
    expect(await anyStoryboardProjectInWorkspaceFolders([], async () => true)).toBe(false)
  })

  it("returns true when project.json exists for a workspace folder", async () => {
    const root = vscode.Uri.file("/ws/proj")
    const folders = [{ uri: root, name: "proj", index: 0 }] as vscode.WorkspaceFolder[]
    const projectJson = vscode.Uri.joinPath(root, ".storyboard", "project.json")
    const exists = async (uri: vscode.Uri): Promise<boolean> => uri.fsPath === projectJson.fsPath
    expect(await anyStoryboardProjectInWorkspaceFolders(folders, exists)).toBe(true)
  })

  it("checks every workspace folder", async () => {
    const a = vscode.Uri.file("/ws/a")
    const b = vscode.Uri.file("/ws/b")
    const folders = [
      { uri: a, name: "a", index: 0 },
      { uri: b, name: "b", index: 1 }
    ] as vscode.WorkspaceFolder[]
    const bProject = vscode.Uri.joinPath(b, ".storyboard", "project.json")
    const exists = async (uri: vscode.Uri): Promise<boolean> => uri.fsPath === bProject.fsPath
    expect(await anyStoryboardProjectInWorkspaceFolders(folders, exists)).toBe(true)
  })
})
