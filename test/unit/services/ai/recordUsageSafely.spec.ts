import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { recordUsageSafely } from "@/services/ai/recordUsageSafely"
import type { UsageRecorder } from "@/services/ai/UsageRecorder"
import type { UsageRecord } from "@/shared/aiTypes"

describe("recordUsageSafely", () => {
  it("logs when ledger record fails", async () => {
    const failure = new Error("disk full")
    const recorder = {
      record: vi.fn(async (): Promise<void> => {
        throw failure
      })
    } as unknown as UsageRecorder

    const logger = {
      error: vi.fn()
    }

    const root = vscode.Uri.file("/tmp/ws")
    const record: UsageRecord = {
      taskName: "sceneDraft",
      providerId: "mock",
      costUsd: 0,
      attribution: { primary: { kind: "scene", id: "01-a" } }
    }

    recordUsageSafely(recorder, root, record, logger)

    await Promise.resolve()
    await Promise.resolve()

    expect(logger.error).toHaveBeenCalledWith("Failed to record AI usage", failure)
  })
})
