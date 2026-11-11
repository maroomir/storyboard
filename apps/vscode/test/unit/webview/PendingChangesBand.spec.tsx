import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PendingChangesBand } from "@webview/components/sidebar/PendingChangesBand"

afterEach(() => cleanup())

function respond(method: string, payload: unknown, postMessage: ReturnType<typeof vi.fn>): void {
  const request = postMessage.mock.calls
    .map((call) => call[0] as { id: string; method: string })
    .filter((message) => message.method === method)
    .at(-1)
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "response", id: request?.id, ok: true, payload } })
  )
}

const changes = [
  {
    origin: "interview",
    summary: "1줄",
    sections: [{ id: "voice", label: "말투", lines: [{ text: "반말, 이름 대신 «야»", label: "세라" }] }]
  }
]

describe("PendingChangesBand", () => {
  it("lists the card's waiting changes and applies them all", async () => {
    const postMessage = vi.fn()
    const onSettled = vi.fn()
    render(<PendingChangesBand slug="elia" refreshKey="chat:0" vscodeApi={{ postMessage }} onSettled={onSettled} />)

    respond("cards.pending.list", { ok: true, changes }, postMessage)

    expect(await screen.findByText("이 카드에 제안 1건이 기다려요")).toBeTruthy()
    expect(screen.getByText("반말, 이름 대신 «야»")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "적용" }))
    respond("cards.pending.apply", { ok: true, message: "1줄을 적용했어요." }, postMessage)

    await waitFor(() => expect(onSettled).toHaveBeenCalled())
    const applyRequest = postMessage.mock.calls.map((call) => call[0]).find((message) => message.method === "cards.pending.apply")
    expect(applyRequest).toMatchObject({ payload: { slug: "elia" } })
  })

  it("draws nothing when no change waits", async () => {
    const postMessage = vi.fn()
    const { container } = render(
      <PendingChangesBand slug="elia" refreshKey="chat:0" vscodeApi={{ postMessage }} onSettled={vi.fn()} />
    )

    respond("cards.pending.list", { ok: true, changes: [] }, postMessage)

    await waitFor(() => expect(postMessage).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
})
