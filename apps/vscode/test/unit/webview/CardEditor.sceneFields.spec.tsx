import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardEditor } from "@webview/components/editor/CardEditor"
import type { CardEditorInitialData, SceneCard } from "@webview/lib/types"

const sceneCard: SceneCard = {
  type: "scene",
  id: "01-prologue",
  title: "프롤로그",
  characters: ["elia"],
  location: "school",
  grounding: { incident: "첫 등교일에 소문이 퍼졌다" },
  purpose: "첫 만남을 보여준다",
  foreshadowing: ["전학 이유"],
  beats: ["첫 비트", "둘째 비트"],
  summary: "자유 메모"
}

const initialData: CardEditorInitialData = {
  documentUri: "file:///workspace/scene/01-prologue.card",
  rawText: "type: scene\nid: 01-prologue\n",
  card: sceneCard
}

function renderWithApi(): { readonly postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
  render(<CardEditor initialData={initialData} />)
  return { postMessage }
}

describe("CardEditor scene form", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the scene form with grounding and structure fields", () => {
    renderWithApi()

    const form = within(screen.getByLabelText("카드 편집 폼"))
    expect(form.getByText("씬 정보")).toBeTruthy()
    expect(form.getByText("사실 시트 (Grounding)")).toBeTruthy()
    expect(form.getByText("목적")).toBeTruthy()
    expect(form.getByText("회수할 복선")).toBeTruthy()
    expect(form.getByText("Summary (자유 메모 — <stem>.summary.md 에 저장)")).toBeTruthy()
  })

  it("shows entity-only tabs for neither collect nor AI record", () => {
    renderWithApi()

    expect(screen.queryByRole("tab", { name: "수집" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "AI 기록" })).toBeNull()
    expect(screen.getByRole("tab", { name: "YAML" })).toBeTruthy()
  })

  it("writes the edited scene card through cards.write", () => {
    const { postMessage } = renderWithApi()

    const form = within(screen.getByLabelText("카드 편집 폼"))
    const purposeField = form.getByText("목적").closest("label") as HTMLElement
    const textarea = purposeField.querySelector("textarea") as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "귀향 이유를 제시한다" } })

    expect(postMessage).toHaveBeenCalledTimes(1)
    const message = postMessage.mock.calls[0]?.[0]
    expect(message.method).toBe("cards.write")
    expect(message.payload.card).toMatchObject({
      type: "scene",
      id: "01-prologue",
      purpose: "귀향 이유를 제시한다",
      beats: ["첫 비트", "둘째 비트"],
      summary: "자유 메모"
    })
  })

  it("lists the expanded beats in the preview", () => {
    renderWithApi()

    expect(screen.getByText("Beats")).toBeTruthy()
    expect(screen.getByText("둘째 비트")).toBeTruthy()
  })
})
