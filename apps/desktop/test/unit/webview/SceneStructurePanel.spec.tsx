import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  applyStructureProposal,
  SceneStructurePanel
} from "@webview/components/editor/SceneStructurePanel"
import type { SceneCard } from "@webview/lib/types"

const sceneCard: SceneCard = {
  type: "scene",
  id: "01-prologue",
  purpose: "사용자가 적은 목적",
  summary: "장마가 이어지는 밤, 준오가 문을 연다."
}

function renderPanel(card: SceneCard = sceneCard): {
  readonly postMessage: ReturnType<typeof vi.fn>
  readonly updateCard: ReturnType<typeof vi.fn>
} {
  const postMessage = vi.fn()
  const updateCard = vi.fn()
  render(
    <SceneStructurePanel
      card={card}
      documentUri="file:///workspace/scene/01-prologue.card"
      vscodeApi={{ postMessage } as never}
      updateCard={updateCard}
      onStatusChange={() => undefined}
    />
  )
  return { postMessage, updateCard }
}

function respondWith(postMessage: ReturnType<typeof vi.fn>, proposal: unknown): void {
  const request = postMessage.mock.calls[0]?.[0]
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "response", id: request.id, ok: true, payload: { proposal } }
    })
  )
}

describe("applyStructureProposal", () => {
  it("fills only the empty fields and keeps user-authored values", () => {
    const applied = applyStructureProposal(sceneCard, {
      purpose: "AI가 제안한 목적",
      conflict: "AI가 제안한 갈등",
      foreshadowing: ["복선 하나", "  "]
    })

    expect(applied.purpose).toBe("사용자가 적은 목적")
    expect(applied.conflict).toBe("AI가 제안한 갈등")
    expect(applied.foreshadowing).toEqual(["복선 하나"])
  })

  it("keeps a non-empty list untouched", () => {
    const withList: SceneCard = { ...sceneCard, foreshadowing: ["기존 복선"] }

    expect(applyStructureProposal(withList, { foreshadowing: ["새 복선"] }).foreshadowing).toEqual([
      "기존 복선"
    ])
  })
})

describe("SceneStructurePanel", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("disables the request when summary is empty", () => {
    renderPanel({ type: "scene", id: "01-prologue" })

    expect(screen.getByRole("button", { name: "Summary에서 구조화" })).toHaveProperty("disabled", true)
  })

  it("requests a proposal and applies it only after review", async () => {
    const { postMessage, updateCard } = renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Summary에서 구조화" }))

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage.mock.calls[0]?.[0].method).toBe("cards.structureScene")
    expect(updateCard).not.toHaveBeenCalled()

    respondWith(postMessage, { conflict: "AI가 제안한 갈등" })

    const region = await waitFor(() => screen.getByRole("region", { name: "구조화 제안" }))
    expect(within(region).getByText("AI가 제안한 갈등")).toBeTruthy()
    expect(updateCard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "비어 있는 필드에 반영" }))

    expect(updateCard).toHaveBeenCalledTimes(1)
    expect(updateCard.mock.calls[0]?.[0]).toMatchObject({
      purpose: "사용자가 적은 목적",
      conflict: "AI가 제안한 갈등"
    })
  })

  it("does not show a review card when the proposal is empty", async () => {
    const { postMessage, updateCard } = renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Summary에서 구조화" }))
    respondWith(postMessage, {})

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Summary에서 구조화" })).toHaveProperty(
        "disabled",
        false
      )
    )
    expect(screen.queryByRole("region", { name: "구조화 제안" })).toBeNull()
    expect(updateCard).not.toHaveBeenCalled()
  })
})
