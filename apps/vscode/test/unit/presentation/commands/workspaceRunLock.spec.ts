import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createWorkspaceRunLockRecord,
  getStoryboardProjectPaths,
  serializeWorkspaceRunLock,
  type IFileSystem
} from "@storyboard/story-engine"
import { runHoldingWorkspaceLock } from "@/presentation/commands/workspaceRunLock"

const workspaceRoot = vscode.Uri.file("/ws")
const lockPath = getStoryboardProjectPaths(workspaceRoot as never).runLock.fsPath

function createMemoryFileSystem(): IFileSystem & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()

  return {
    files,
    readFile: async (uri) => {
      const content = files.get(uri.fsPath)
      if (!content) throw new Error(`missing ${uri.fsPath}`)
      return content
    },
    writeFile: async (uri, content) => void files.set(uri.fsPath, content),
    createDirectory: async () => undefined,
    exists: async (uri) => files.has(uri.fsPath),
    listFileNames: async () => [],
    readDirectory: async () => [],
    delete: async (uri) => void files.delete(uri.fsPath),
    modifiedTime: async () => 0
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runHoldingWorkspaceLock", () => {
  it("holds the lock while the command runs and releases it afterwards", async () => {
    const fileSystem = createMemoryFileSystem()
    let wasHeldDuringRun = false

    await runHoldingWorkspaceLock(fileSystem, workspaceRoot, "장편 생성", async () => {
      wasHeldDuringRun = fileSystem.files.has(lockPath)
    })

    expect(wasHeldDuringRun).toBe(true)
    expect(fileSystem.files.has(lockPath)).toBe(false)
  })

  it("does not run and warns when another app holds the workspace", async () => {
    const fileSystem = createMemoryFileSystem()
    const record = createWorkspaceRunLockRecord(
      { owner: "desktop", label: "장편 생성", pid: 1, hostname: "writer" },
      "desktop-token",
      new Date()
    )
    fileSystem.files.set(lockPath, new TextEncoder().encode(serializeWorkspaceRunLock(record)))
    const warn = vi.spyOn(vscode.window, "showWarningMessage")
    const run = vi.fn(async () => undefined)

    await runHoldingWorkspaceLock(fileSystem, workspaceRoot, "초안 생성", run)

    expect(run).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("데스크톱 앱이(가) «장편 생성»"))
  })
})
