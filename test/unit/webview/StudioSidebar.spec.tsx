import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StudioSidebar } from "@webview/components/sidebar/StudioSidebar"
import type { StudioInitialData, StudioTarget } from "@webview/lib/types"

const draftTarget: StudioTarget = {
  kind: "draft",
  label: "01-intro.md",
  sceneUri: "file:///scene/01-intro.txt",
  draftUri: "file:///draft/01-intro.md",
  hasSelection: false
}

function renderStudio(target: StudioTarget): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))

  const initialData: StudioInitialData = { title: "Studio", target }
  render(<StudioSidebar initialData={initialData} />)
  return postMessage
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("StudioSidebar chat loop", () => {
  it("turns a typed instruction into an approvable proposal and runs it", async () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "맞춤법 봐줘" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText("맞춤법 봐줘")).toBeTruthy()
    expect(screen.getByText("문법 검사")).toBeTruthy()

    fireEvent.click(screen.getByText("승인"))

    expect(postMessage).toHaveBeenCalledTimes(1)
    const sent = postMessage.mock.calls[0][0]
    expect(sent.method).toBe("studio.runAction")
    expect(sent.payload.action).toBe("grammarCheck")
    expect(screen.getByText("실행 중…")).toBeTruthy()

    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", id: sent.id, ok: true } }))

    await waitFor(() => expect(screen.getByText("완료")).toBeTruthy())
  })

  it("does not run when a proposal is cancelled", () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "카드로 보충" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText("카드 기반 보충")).toBeTruthy()

    fireEvent.click(screen.getByText("취소"))

    expect(postMessage).not.toHaveBeenCalled()
    expect(screen.getByText("취소됨")).toBeTruthy()
  })

  it("forwards the typed instruction when editing a selection", () => {
    const postMessage = renderStudio({ ...draftTarget, hasSelection: true })

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "더 긴장감 있게 고쳐줘" } })
    fireEvent.keyDown(composer, { key: "Enter" })

    expect(screen.getByText("선택 영역 편집")).toBeTruthy()

    fireEvent.click(screen.getByText("승인"))

    const sent = postMessage.mock.calls[0][0]
    expect(sent.payload.action).toBe("editSelection")
    expect(sent.payload.instruction).toBe("더 긴장감 있게 고쳐줘")
  })

  it("asks for a selection and offers chips when intent is unmet", () => {
    renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "짧게 줄여줘" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText(/영역을 먼저 선택/)).toBeTruthy()
    expect(screen.getByText("문법 검사")).toBeTruthy()
  })

  it("renders a proposal directly when a suggestion chip is picked", () => {
    renderStudio(draftTarget)

    fireEvent.click(screen.getByText("연속성 검사"))

    expect(screen.getByText("승인")).toBeTruthy()
  })

  it("reflects target changes from the host", async () => {
    renderStudio({ kind: "none", hasSelection: false })

    expect(screen.getByText("대상 없음")).toBeTruthy()

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "event", method: "studio.targetChanged", payload: draftTarget }
      })
    )

    await waitFor(() => expect(screen.getAllByText(/01-intro\.md/).length).toBeGreaterThan(0))
  })
})
