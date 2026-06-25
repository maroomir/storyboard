import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardEditor } from "@webview/components/editor/CardEditor"
import type { CardEditorInitialData, StoryboardCard } from "@webview/lib/types"

const card: StoryboardCard = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main",
  voice: ["또렷하고 단단한 1인칭"],
  aliases: ["엘리"],
  description: ["주인공"],
  traits: ["결단력 있는 발언"],
  attributes: { age: 17 },
  arc: [{ stage: "발단", summary: "등교" }],
  relations: [{ target: "jihoon", type: "친구" }],
  recentDialogues: ["가자!"]
}

const initialData: CardEditorInitialData = {
  documentUri: "file:///workspace/character/elia.card",
  rawText: "type: character\nid: elia\nname: 엘리아\n",
  card
}

function renderWithApi(): { readonly postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
  render(<CardEditor initialData={initialData} />)
  return { postMessage }
}

describe("CardEditor manual fields", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("surfaces Voice and Aliases inputs on the 편집 tab", () => {
    renderWithApi()

    expect(screen.getByText("Voice")).toBeTruthy()
    expect(screen.getByText("Aliases")).toBeTruthy()
  })

  it("does not render editable inputs for AI-managed fields", () => {
    renderWithApi()

    expect(screen.queryByText("Traits")).toBeNull()
    expect(screen.queryByText("Recent Dialogues")).toBeNull()
    expect(screen.queryByText("Attributes")).toBeNull()
    expect(screen.getByRole("tab", { name: "AI 기록" })).toBeTruthy()
  })

  it("preserves AI-managed fields when a manual field is edited", () => {
    const { postMessage } = renderWithApi()

    const voiceFieldset = screen.getByText("Voice").closest("fieldset") as HTMLElement
    const voiceInput = within(voiceFieldset).getAllByRole("textbox")[0] as HTMLElement
    fireEvent.change(voiceInput, { target: { value: "차분한 1인칭" } })

    const lastCall = postMessage.mock.calls.at(-1)?.[0] as { readonly payload: { readonly card: StoryboardCard } }
    expect(lastCall.payload.card).toEqual(
      expect.objectContaining({
        voice: ["차분한 1인칭"],
        traits: ["결단력 있는 발언"],
        attributes: { age: 17 },
        arc: [{ stage: "발단", summary: "등교" }],
        relations: [{ target: "jihoon", type: "친구" }],
        recentDialogues: ["가자!"]
      })
    )
  })
})
