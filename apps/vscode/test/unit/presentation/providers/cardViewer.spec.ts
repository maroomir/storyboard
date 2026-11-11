import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CardViewerSession,
  locateBundle,
  type CardCustomEditorDependencies
} from "@/presentation/providers/CardCustomEditorProvider"
import { workspace, type WorkspaceFolder } from "../../../stubs/vscode"

const workspaceRoot = vscode.Uri.file("/ws")
const cardUri = vscode.Uri.file("/ws/scene/003-rooftop.card/card.yaml")

beforeEach(() => {
  workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
    uri.fsPath.startsWith(workspaceRoot.fsPath) ? { uri: workspaceRoot, name: "ws", index: 0 } : undefined
})

function sessionFor(readView: ReturnType<typeof vi.fn>): CardViewerSession {
  const document = { uri: cardUri } as unknown as vscode.TextDocument
  const panel = { webview: { asWebviewUri: (uri: vscode.Uri): vscode.Uri => uri } } as unknown as vscode.WebviewPanel
  const dependencies = { cards: { readView }, logger: {} } as unknown as CardCustomEditorDependencies

  return new CardViewerSession(document, panel, dependencies, locateBundle(cardUri))
}

describe("card viewer", () => {
  it("locates the bundle of a card.yaml by its kind folder", () => {
    expect(locateBundle(cardUri)).toMatchObject({
      workspaceRoot,
      kind: "scene",
      directoryName: "003-rooftop.card"
    })
    expect(locateBundle(vscode.Uri.file("/ws/notes/x.card/card.yaml"))).toBeUndefined()
  })

  it("reads the view through the card manager and passes on its warnings", async () => {
    const view = { kind: "scene", slug: "rooftop", name: "옥상", facts: [], sections: [] }
    const readView = vi.fn(async () => ({ ok: true, view, bundlePath: "scene/003-rooftop.card", warnings: ["경고"] }))

    const data = await sessionFor(readView).loadViewerData()

    expect(readView).toHaveBeenCalledWith(workspaceRoot, "scene", "003-rooftop.card")
    expect(data).toEqual({ documentUri: cardUri.toString(), view, warnings: ["경고"] })
  })

  it("shows the engine's refusal when the bundle cannot be read", async () => {
    const readView = vi.fn(async () => ({ ok: false, message: "card.yaml 의 형식이 올바르지 않습니다." }))

    expect(await sessionFor(readView).loadViewerData()).toEqual({
      documentUri: cardUri.toString(),
      warnings: [],
      error: "card.yaml 의 형식이 올바르지 않습니다."
    })
  })
})
