import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { workspace, type WorkspaceFolder } from "../../stubs/vscode"

vi.mock("@/core/workspace", () => ({
  uriExists: async (): Promise<boolean> => false,
  hasStoryboardProject: async (): Promise<boolean> => true
}))

import { maybeRunReviseAfterGenerate } from "@/commands/reviseDraft"

const workspaceRoot = vscode.Uri.file("/ws")
const folder: WorkspaceFolder = { uri: workspaceRoot as never, name: "ws", index: 0 }
const validScene = vscode.Uri.file("/ws/scene/01-intro.txt")

const dependencies = {
  aiProviderRegistry: {} as never,
  usageRecorder: {} as never,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn() } as never
}

function configBridge(enabled: boolean): never {
  return { isReviseAfterGenerateEnabled: () => enabled } as never
}

const originalGetWorkspaceFolder = workspace.getWorkspaceFolder

afterEach(() => {
  workspace.getWorkspaceFolder = originalGetWorkspaceFolder
})

describe("maybeRunReviseAfterGenerate", () => {
  it("skips when revise-after-generate is disabled", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()

    await maybeRunReviseAfterGenerate(validScene as never, configBridge(false), dependencies, { onWillRun })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("skips when cancellation is already requested", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()

    await maybeRunReviseAfterGenerate(validScene as never, configBridge(true), dependencies, {
      onWillRun,
      shouldCancel: () => true
    })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("skips when the scene filename has no parseable stem", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()
    const badScene = vscode.Uri.file("/ws/scene/not-a-scene.md")

    await maybeRunReviseAfterGenerate(badScene as never, configBridge(true), dependencies, { onWillRun })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("runs the gate (onWillRun fires) when enabled with a valid scene", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()

    await maybeRunReviseAfterGenerate(validScene as never, configBridge(true), dependencies, { onWillRun })

    expect(onWillRun).toHaveBeenCalledTimes(1)
  })
})
