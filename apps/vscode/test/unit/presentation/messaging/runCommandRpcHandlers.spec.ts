import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { workspaceRunCommandRequestPayloadSchema } from "@storyboard/story-engine"

import { createRunCommandRpcHandlers } from "@/presentation/messaging/runCommandRpcHandlers"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("workspace.runCommand", () => {
  it("runs an allowlisted command", async () => {
    const execute = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const handlers = createRunCommandRpcHandlers()

    await handlers["workspace.runCommand"]!({ command: "storyboard.init" }, {} as never)

    expect(execute).toHaveBeenCalledWith("storyboard.init")
  })

  // SECURITY: the webview must not be able to name arbitrary commands.
  it("rejects a command outside the sidebar allowlist at the schema boundary", () => {
    expect(
      workspaceRunCommandRequestPayloadSchema.safeParse({ command: "workbench.action.terminal.new" }).success
    ).toBe(false)
    expect(workspaceRunCommandRequestPayloadSchema.safeParse({ command: "storyboard.scene.create" }).success).toBe(
      true
    )
  })
})
