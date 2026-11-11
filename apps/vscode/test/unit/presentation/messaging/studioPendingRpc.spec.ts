import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import { StudioPendingRpc } from "@/presentation/messaging/studioPendingRpcHandlers"

const workspaceRoot = vscode.Uri.file("/ws")
const studio = { origin: "studio" } as const

function rpcWith(cards: Record<string, unknown>): StudioPendingRpc {
  return new StudioPendingRpc({ cards: cards as never, getProjectRoot: async (): Promise<vscode.Uri> => workspaceRoot })
}

describe("studio pending rpc", () => {
  it("lists the card's pending changes as sections", async () => {
    const sections = [{ id: "voice", label: "말투", lines: [{ text: "반말" }] }]
    const readPendingView = vi.fn(async () => ({ ok: true, report: [{ origin: "interview", summary: "1줄", sections }] }))

    const result = await rpcWith({ readPendingView }).handlers()["cards.pending.list"]({ slug: "elia" })

    expect(readPendingView).toHaveBeenCalledWith(workspaceRoot, "elia")
    expect(result).toEqual({ ok: true, changes: [{ origin: "interview", summary: "1줄", sections }] })
  })

  it("says how many lines it applied and which the author's lines held back", async () => {
    const applyPending = vi.fn(async () => ({
      ok: true,
      report: { applied: 2, heldByAuthor: [{ facet: "voice", value: "존댓말", source: studio }], failures: [] }
    }))

    expect(await rpcWith({ applyPending }).handlers()["cards.pending.apply"]({ slug: "elia" })).toEqual({
      ok: true,
      message: "2줄을 적용했어요. 작가가 쓴 줄과 겹친 1줄은 그대로 뒀어요."
    })
  })

  it("passes on a missing card", async () => {
    const discardPending = vi.fn(async () => ({ ok: false, kind: "missing", message: "카드를 찾을 수 없습니다: x" }))

    expect(await rpcWith({ discardPending }).handlers()["cards.pending.discard"]({ slug: "x" })).toEqual({
      ok: false,
      message: "카드를 찾을 수 없습니다: x"
    })
  })
})
