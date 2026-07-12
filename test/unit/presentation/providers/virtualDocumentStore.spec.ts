import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import { VirtualDocumentStore } from "@/presentation/providers/virtual-document-store"

describe("VirtualDocumentStore", () => {
  it("returns stored content and emits a change for the updated URI", () => {
    const store = new VirtualDocumentStore()
    const uri = vscode.Uri.file("/workspace/draft.md")
    const listener = vi.fn()
    const subscription = store.onDidChange(listener)

    store.setContent(uri, "제안 본문")

    expect(store.provideTextDocumentContent(uri)).toBe("제안 본문")
    expect(listener).toHaveBeenCalledWith(uri)

    subscription.dispose()
    store.dispose()
  })

  it("clears content when disposed", () => {
    const store = new VirtualDocumentStore()
    const uri = vscode.Uri.file("/workspace/draft.md")
    store.setContent(uri, "제안 본문")

    store.dispose()

    expect(store.provideTextDocumentContent(uri)).toBe("")
  })
})
