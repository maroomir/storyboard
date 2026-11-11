import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkspaceCaches, WorkspaceRunLocks, type IFileSystem } from "@storyboard/story-engine"
import { RunGate } from "@storyboard/story-app"
import { MemorySqlDatabaseHost } from "@storyboard/story-node"
import { runHoldingWorkspaceLock } from "@/presentation/commands/workspaceRunLock"

const workspaceRoot = vscode.Uri.file("/ws")

function createMemoryFileSystem(): IFileSystem {
  return {
    readFile: async (uri): Promise<Uint8Array> => {
      throw new Error(`missing ${uri.fsPath}`)
    },
    writeFile: async () => undefined,
    createDirectory: async () => undefined,
    exists: async () => false,
    listFileNames: async () => [],
    readDirectory: async () => [],
    delete: async () => undefined,
    modifiedTime: async () => 0,
    isRealPathInside: async () => true
  }
}

function createRunLocks(): WorkspaceRunLocks {
  const caches = new WorkspaceCaches({ host: new MemorySqlDatabaseHost(), fileSystem: createMemoryFileSystem() })
  return new WorkspaceRunLocks({ caches })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runHoldingWorkspaceLock", () => {
  it("holds the lock while the command runs and releases it afterwards", async () => {
    const runLocks = createRunLocks()
    let wasHeldDuringRun = false

    await runHoldingWorkspaceLock(new RunGate({ runLocks, owner: "vscode" }), workspaceRoot, "장편 생성", async () => {
      wasHeldDuringRun = (await runLocks.readHolder(workspaceRoot))?.owner === "vscode"
    })

    expect(wasHeldDuringRun).toBe(true)
    expect(await runLocks.readHolder(workspaceRoot)).toBeUndefined()
  })

  it("does not run and warns when another app holds the workspace", async () => {
    const runLocks = createRunLocks()
    const acquired = await runLocks.acquire(workspaceRoot, { owner: "cli", label: "장편 생성", pid: 1, hostname: "writer" })
    expect(acquired.ok).toBe(true)
    const warn = vi.spyOn(vscode.window, "showWarningMessage")
    const run = vi.fn(async () => undefined)

    await runHoldingWorkspaceLock(new RunGate({ runLocks, owner: "vscode" }), workspaceRoot, "초안 생성", run)

    expect(run).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CLI이(가) «장편 생성»"))
  })
})
