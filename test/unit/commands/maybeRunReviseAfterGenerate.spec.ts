import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { workspace, type WorkspaceFolder } from "../../stubs/vscode"

vi.mock("@/infrastructure/vscode/workspace", () => ({
  uriExists: async (): Promise<boolean> => false,
  hasStoryboardProject: async (): Promise<boolean> => true
}))

import { ReviseAfterGenerateGate } from "@/application/drafts/reviseAfterGenerateGate"

const workspaceRoot = vscode.Uri.file("/ws")
const folder: WorkspaceFolder = { uri: workspaceRoot as never, name: "ws", index: 0 }
const validScene = vscode.Uri.file("/ws/scene/01-intro.txt")

const dependencies = {
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

    await new ReviseAfterGenerateGate(
      configBridge(false),
      dependencies.logger,
      {} as never
    ).maybeRunAfterGenerate(validScene as never, { onWillRun })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("skips when cancellation is already requested", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()

    await new ReviseAfterGenerateGate(
      configBridge(true),
      dependencies.logger,
      {} as never
    ).maybeRunAfterGenerate(validScene as never, {
      onWillRun,
      shouldCancel: () => true
    })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("skips when the scene filename has no parseable stem", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()
    const badScene = vscode.Uri.file("/ws/scene/not-a-scene.md")

    await new ReviseAfterGenerateGate(
      configBridge(true),
      dependencies.logger,
      {} as never
    ).maybeRunAfterGenerate(badScene as never, { onWillRun })

    expect(onWillRun).not.toHaveBeenCalled()
  })

  it("runs the gate (onWillRun fires) when enabled with a valid scene", async () => {
    workspace.getWorkspaceFolder = (): WorkspaceFolder => folder
    const onWillRun = vi.fn()

    await new ReviseAfterGenerateGate(
      configBridge(true),
      dependencies.logger,
      {} as never
    ).maybeRunAfterGenerate(validScene as never, { onWillRun })

    expect(onWillRun).toHaveBeenCalledTimes(1)
  })
})
