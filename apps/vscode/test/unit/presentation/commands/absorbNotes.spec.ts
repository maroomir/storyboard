import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerAbsorbNotesCommand } from "@/presentation/commands/absorbNotes"
import { commands, FileType, window, workspace, type WorkspaceFolder } from "../../../stubs/vscode"

describe("absorbNotes command", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }
  const projectJsonPath = vscode.Uri.joinPath(workspaceRoot, ".storyboard", "project.json").fsPath
  const vaultUri = vscode.Uri.file("/vault/달의 문")

  let handler: (() => Promise<void>) | undefined
  const bundle = { kind: "obsidian", location: "/vault/달의 문", collectedAt: "2026-10-24T00:00:00.000Z", notes: [], skipped: [] }
  const plan = {
    cards: [{ card: { type: "character", id: "hana", name: "하나" }, isNew: true, changes: [], sourceNotes: [], aliasReadCounts: {} }],
    scenes: [],
    skippedScenes: [],
    setting: {},
    unclassifiedNotes: [],
    draftNotes: [],
    voiceSeeds: {},
    canonCandidates: [],
    warnings: []
  }
  const notes = {
    collect: vi.fn(async () => ({ ok: true as const, bundle })),
    estimate: vi.fn(() => ({
      noteCount: 3, linkedNoteCount: 1, characterCount: 1200, requestCount: 1, inputTokens: 900, outputTokenCeiling: 4000,
      providerId: "claude" as const, model: "claude-sonnet-5", costCeilingUsd: 0.07
    })),
    plan: vi.fn(async () => ({ ok: true as const, plan })),
    apply: vi.fn(async () => ({
      ok: true as const, createdCards: ["hana"], candidateCards: [], pendingCandidateCards: [], createdScenes: [], skippedScenes: [],
      synopsis: "none" as const, filledSettingKeys: [], settingProposals: {}, seededCharacters: [], canonCandidates: 0
    }))
  }
  const hold = vi.fn(async (_root: unknown, _label: string, run: () => Promise<void>) => {
    await run()
    return { ok: true as const }
  })
  const answers: string[] = []

  beforeEach(() => {
    handler = undefined
    answers.length = 0
    for (const fn of Object.values(notes)) fn.mockClear()
    hold.mockClear()

    workspace.workspaceFolders = [workspaceFolder]
    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
    workspace.fs.stat = async (uri): Promise<{ type: FileType }> => {
      if (uri.fsPath === projectJsonPath) {
        return { type: FileType.File }
      }
      throw new Error("not found")
    }

    window.showQuickPick = vi.fn(async (items: unknown) => (items as { kind: string }[])[0])
    window.showOpenDialog = vi.fn(async () => [vaultUri])
    window.showInformationMessage = vi.fn(async (_message: string, ...rest: unknown[]) => {
      const buttons = rest.filter((item): item is string => typeof item === "string")
      return buttons.length > 0 ? answers.shift() : undefined
    })
    window.showErrorMessage = vi.fn(async () => undefined)

    vi.spyOn(commands, "registerCommand").mockImplementation((command, callback) => {
      if (command === "storyboard.notes.absorb") {
        handler = callback as () => Promise<void>
      }
      return { dispose: vi.fn() }
    })
  })

  it("reads, shows the estimate and the plan, then applies under the workspace lock", async () => {
    answers.push("정리", "반영")
    registerAbsorbNotesCommand({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() }, notes, runGate: { hold } })

    await handler!()

    expect(notes.collect).toHaveBeenCalledWith({ workspaceRoot, location: { kind: "obsidian", root: vaultUri } })
    expect(notes.plan).toHaveBeenCalledWith({ workspaceRoot, bundle })
    expect(hold).toHaveBeenCalledOnce()
    expect(notes.apply).toHaveBeenCalledWith({
      workspaceRoot,
      plan,
      location: bundle.location,
      shouldFillContract: false,
      shouldReplaceCandidates: false
    })
    const detail = (window.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as { detail: string }
    expect(detail.detail).toContain("AI 요청 1번")
  })

  it("spends nothing when the estimate is declined and writes nothing when the plan is declined", async () => {
    registerAbsorbNotesCommand({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() }, notes, runGate: { hold } })

    await handler!()
    expect(notes.plan).not.toHaveBeenCalled()

    answers.push("정리")
    await handler!()
    expect(notes.plan).toHaveBeenCalledOnce()
    expect(notes.apply).not.toHaveBeenCalled()
  })

  it("asks for a Notion address when that source is picked", async () => {
    window.showQuickPick = vi.fn(async (items: unknown) => (items as { kind: string }[])[2])
    window.showInputBox = vi.fn(async () => "https://www.notion.so/team/Moon-Gate-1429989fe8ac4effbc8f57f56486db54")
    registerAbsorbNotesCommand({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() }, notes, runGate: { hold } })

    await handler!()

    expect(notes.collect).toHaveBeenCalledWith({
      workspaceRoot,
      location: { kind: "notion", pageUrl: "https://www.notion.so/team/Moon-Gate-1429989fe8ac4effbc8f57f56486db54" }
    })
  })
})
