import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardEditor } from "@webview/components/editor/CardEditor"
import type { CardEditorInitialData, NarratorCard } from "@webview/lib/types"

const narratorCard: NarratorCard = {
  type: "narrator",
  id: "jiwoon-limited",
  name: "지운의 시선",
  person: "third",
  knowledge: "witnessed",
  tense: "past",
  focal: "jiwoon",
  voice: ["짧은 단문", "본 것만 적는다"]
}

const initialData: CardEditorInitialData = {
  documentUri: "file:///workspace/narrator/jiwoon-limited.card",
  rawText: "type: narrator\nid: jiwoon-limited\n",
  card: narratorCard
}

function renderWithApi(): { readonly postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
  render(<CardEditor initialData={initialData} />)
  return { postMessage }
}

describe("CardEditor narrator form", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the narrator fields instead of background fields", () => {
    renderWithApi()

    const form = within(screen.getByLabelText("카드 편집 폼"))
    expect(form.getByText("서술자 정보")).toBeTruthy()
    expect((form.getByLabelText("인칭") as HTMLSelectElement).value).toBe("third")
    expect((form.getByLabelText("지식 범위") as HTMLSelectElement).value).toBe("witnessed")
    expect((form.getByLabelText("시제") as HTMLSelectElement).value).toBe("past")
    expect((form.getByLabelText("초점 인물") as HTMLInputElement).value).toBe("jiwoon")
    expect(form.getByDisplayValue("본 것만 적는다")).toBeTruthy()
    expect(form.queryByText("Weather")).toBeNull()
  })

  it("offers neither collect nor AI record tabs", () => {
    renderWithApi()

    expect(screen.queryByRole("tab", { name: "수집" })).toBeNull()
    expect(screen.queryByRole("tab", { name: "AI 기록" })).toBeNull()
    expect(screen.getByRole("tab", { name: "YAML" })).toBeTruthy()
  })

  it("shows the narration summary in the preview", () => {
    renderWithApi()

    const preview = within(screen.getByLabelText("서술자 미리보기"))
    expect(preview.getByText("3인칭")).toBeTruthy()
    expect(preview.getByText("목격 범위")).toBeTruthy()
    expect(preview.getByText("과거형")).toBeTruthy()
  })

  it("writes an edited knowledge value through cards.write", () => {
    const { postMessage } = renderWithApi()

    const form = within(screen.getByLabelText("카드 편집 폼"))
    fireEvent.change(form.getByLabelText("지식 범위"), { target: { value: "omniscient" } })

    expect(postMessage).toHaveBeenCalledTimes(1)
    const message = postMessage.mock.calls[0]?.[0]
    expect(message.method).toBe("cards.write")
    expect(message.payload.card).toEqual({ ...narratorCard, knowledge: "omniscient" })
  })

  it("drops an emptied focal field instead of writing an empty string", () => {
    const { postMessage } = renderWithApi()

    const form = within(screen.getByLabelText("카드 편집 폼"))
    fireEvent.change(form.getByLabelText("초점 인물"), { target: { value: "" } })

    const message = postMessage.mock.calls[0]?.[0]
    expect(message.payload.card).not.toHaveProperty("focal")
  })
})
