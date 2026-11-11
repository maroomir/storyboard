import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CardRemovalPrompt, describeRemovalPrompt } from "@/presentation/providers/cardRemovalPrompt"
import { window } from "../../../stubs/vscode"

const workspaceRoot = vscode.Uri.file("/ws")
const cardUri = vscode.Uri.file("/ws/character/sera.card/card.yaml")
const plan = {
  path: "character/sera.card",
  cardId: "s-1",
  referencingPaths: ["scene/002-rooftop.card", "character/elia.card"],
  droppedLines: [{ path: "scene/002-rooftop.card/state.yaml", value: "세라만 아는 비밀" }]
}

function promptWith(remove: ReturnType<typeof vi.fn>): CardRemovalPrompt {
  return new CardRemovalPrompt({
    cards: { remove, read: vi.fn(async () => ({ card: { name: "세라" } })) } as never,
    runGate: { hold: vi.fn(async (_root: unknown, _label: string, run: () => Promise<void>) => ({ ok: true, value: await run() })) }
  })
}

beforeEach(() => {
  window.showWarningMessage = vi.fn(async () => undefined)
})

describe("card removal prompt", () => {
  it("counts the references and names the lines it will drop", () => {
    expect(describeRemovalPrompt("세라", plan)).toBe(
      "character/sera.card/ 폴더를 지웁니다. 세라를 가리키는 곳이 2곳 있습니다(scene/002-rooftop.card, character/elia.card). 그 참조를 함께 걷어 냅니다. 세라만 알던 줄 1개는 함께 지웁니다: 세라만 아는 비밀"
    )
  })

  it("previews first and removes with cleanup only after the author confirms", async () => {
    const remove = vi.fn(async (request: { isPreview?: boolean }) =>
      request.isPreview === true ? { ok: true, kind: "previewed", plan } : { ok: true, kind: "removed", plan }
    )
    window.showWarningMessage = vi.fn(async () => "삭제하고 함께 정리") as never

    await promptWith(remove).confirmAndRemove(workspaceRoot, cardUri)

    expect(remove.mock.calls.map((call) => call[0])).toEqual([
      { workspaceRoot, slug: "sera", shouldForce: false, isPreview: true },
      { workspaceRoot, slug: "sera", shouldForce: true }
    ])
    expect((window.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("세라를 삭제할까요?")
  })

  it("leaves everything in place when the author cancels", async () => {
    const remove = vi.fn(async () => ({ ok: true, kind: "previewed", plan }))

    await promptWith(remove).confirmAndRemove(workspaceRoot, cardUri)

    expect(remove).toHaveBeenCalledTimes(1)
  })
})
