import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { UsageLedgerRecorder, UsageStore, WorkspaceCaches, type IFileSystem } from "@storyboard/story-engine"
import { MemorySqlDatabaseHost } from "@storyboard/story-node"

function createCaches(): WorkspaceCaches {
  const fileSystem = { createDirectory: async (): Promise<void> => undefined } as unknown as IFileSystem
  return new WorkspaceCaches({ host: new MemorySqlDatabaseHost(), fileSystem })
}

describe("UsageLedgerRecorder", () => {
  it("appends each record once to the cache db and emits onChange", async () => {
    const caches = createCaches()
    const recorder = new UsageLedgerRecorder({ caches })
    const root = vscode.Uri.file("/tmp/storyboard-ws")
    const listener = vi.fn()
    recorder.onChange(listener)
    const record = {
      recordId: "call-1",
      taskName: "sceneDraft" as const,
      providerId: "mock" as const,
      costUsd: 0.5,
      attribution: { primary: { kind: "scene" as const, id: "01-opening" } }
    }

    await recorder.record(root, record)
    await recorder.record(root, record)

    expect(listener).toHaveBeenCalledTimes(1)
    const entries = new UsageStore(await caches.open(root)).list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.costUsd).toBe(0.5)

    const summary = await recorder.getSummary(root)
    expect(summary.scenes["01-opening"]?.costUsd).toBe(0.5)
    expect(summary.total.costUsd).toBe(0.5)

    recorder.dispose()
    await caches.closeAll()
  })
})
