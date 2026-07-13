import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { getStoryboardProjectPaths } from "@/core/pathConventions"
import { parseUsageLedgerBytes, type UsageLedgerFileSystem } from "@/domain/files/usageLedger"
import { UsageRecorder } from "@/services/ai/UsageRecorder"

function createMemoryFs(): UsageLedgerFileSystem & { readonly bytesByPath: Map<string, Uint8Array> } {
  const bytesByPath = new Map<string, Uint8Array>()
  return {
    bytesByPath,
    readFile: async (uri: unknown): Promise<Uint8Array> => {
      const path = (uri as vscode.Uri).fsPath
      const hit = bytesByPath.get(path)
      if (!hit) {
        throw new Error(`missing ${path}`)
      }
      return hit
    },
    writeFile: async (uri: unknown, content: Uint8Array): Promise<void> => {
      bytesByPath.set((uri as vscode.Uri).fsPath, content)
    },
    createDirectory: async (): Promise<void> => {}
  }
}

describe("UsageRecorder", () => {
  it("appends ledger entries and emits onChange", async () => {
    const fs = createMemoryFs()
    const recorder = new UsageRecorder(fs)
    const root = vscode.Uri.file("/tmp/storyboard-ws")
    const listener = vi.fn()
    recorder.onChange(listener)

    await recorder.record(root, {
      taskName: "sceneDraft",
      providerId: "mock",
      costUsd: 0.5,
      attribution: { primary: { kind: "scene", id: "01-opening" } }
    })

    expect(listener).toHaveBeenCalledTimes(1)

    const ledgerUri = getStoryboardProjectPaths(root).usageLedger
    const bytes = fs.bytesByPath.get(ledgerUri.fsPath)
    expect(bytes).toBeDefined()
    const entries = parseUsageLedgerBytes(bytes as Uint8Array)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.costUsd).toBe(0.5)

    const summary = await recorder.getSummary(root)
    expect(summary.scenes["01-opening"]).toBe(0.5)
    expect(summary.totalUsd).toBe(0.5)

    recorder.dispose()
  })
})
