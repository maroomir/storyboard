import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { BuildStoryCardsFromScenesCommand } from "@/presentation/commands/buildStoryCardsFromScenesCommand"
import { window, workspace } from "../../../stubs/vscode"

const workspaceRoot = vscode.Uri.file("/ws")
const traitProposal = { field: "traits", label: "특성", value: ["고집이 세다"], sourceScenes: ["001-rooftop"] }
const voiceProposal = { field: "voice", label: "말투", value: ["반말"], sourceScenes: ["001-rooftop"] }
const target = {
  card: { type: "character", id: "sera", name: "세라" },
  uriId: "character/sera",
  isNew: true,
  requiresIdConfirmation: false,
  changes: [
    { label: "특성", proposal: traitProposal },
    { label: "말투", proposal: voiceProposal }
  ],
  sourceScenes: ["001-rooftop"]
}

beforeEach(() => {
  workspace.workspaceFolders = [{ uri: workspaceRoot, name: "ws", index: 0 }]
  window.showInformationMessage = vi.fn(async () => undefined)
  window.showErrorMessage = vi.fn(async () => undefined)
  window.withProgress = (async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
    await task({}, { isCancellationRequested: false })) as never
})

describe("build story cards from scenes", () => {
  it("applies only the picked changes of a new card through the engine", async () => {
    const applyBuildTargets = vi.fn(async () => ({ writtenIds: ["elia"], needsIdNames: [] }))
    const showDiffs = vi.fn(async () => undefined)
    window.showQuickPick = vi.fn(async (items: unknown) => [
      { ...(items as { target: unknown }[])[0], proposal: traitProposal }
    ]) as never
    window.showWarningMessage = vi.fn(async () => "적용") as never
    const command = new BuildStoryCardsFromScenesCommand(
      {
        buildFromScenes: vi.fn(async () => ({ targets: [target], snapshots: [] })),
        hasCurrentBuildSources: vi.fn(async () => true),
        applyBuildTargets
      } as never,
      { showDiffs } as never
    )

    await command.run()

    const [, applied] = applyBuildTargets.mock.calls[0] as unknown as [unknown, { changes: unknown[] }[]]
    expect(applied).toHaveLength(1)
    expect(applied[0]?.changes).toEqual([{ label: "특성", proposal: traitProposal }])
    const [review] = showDiffs.mock.calls[0] as unknown as [{ original: unknown; originalText?: string; proposedText: string }[]]
    expect(review[0]?.original).toBeUndefined()
    expect(review[0]?.originalText).toBeUndefined()
    expect(review[0]?.proposedText).toContain("id: sera")
  })

  it("improves an existing card under its own id without asking for one", async () => {
    const existingTarget = { ...target, isNew: false, uriId: "character/sera" }
    const applyBuildTargets = vi.fn(async () => ({ writtenIds: ["sera"], needsIdNames: [] }))
    const showInputBox = vi.fn(async () => undefined)
    window.showInputBox = showInputBox as never
    window.showQuickPick = vi.fn(async (items: unknown) => [
      { ...(items as { target: unknown }[])[0], proposal: traitProposal }
    ]) as never
    window.showWarningMessage = vi.fn(async () => "적용") as never
    const command = new BuildStoryCardsFromScenesCommand(
      {
        buildFromScenes: vi.fn(async () => ({ targets: [existingTarget], snapshots: [] })),
        hasCurrentBuildSources: vi.fn(async () => true),
        applyBuildTargets
      } as never,
      { showDiffs: vi.fn(async () => undefined) } as never
    )

    await command.run()

    expect(showInputBox).not.toHaveBeenCalled()
    const [, applied] = applyBuildTargets.mock.calls[0] as unknown as [unknown, { card: { id: string } }[]]
    expect(applied[0]?.card.id).toBe("sera")
  })
})
