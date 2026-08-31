import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardEditor } from "@webview/components/editor/CardEditor"
import type { CardEditorInitialData, StoryboardCard } from "@webview/lib/types"

const baseCard: StoryboardCard = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main",
  description: ["주인공"]
}

const rawText = `type: character
id: elia
name: 엘리아
role: main
description: 주인공
`

const initialData: CardEditorInitialData = {
  documentUri: "file:///workspace/character/elia.card",
  rawText,
  card: baseCard
}

function createVsCodeApiMock(
  onPostMessage?: (message: {
    readonly id: string
    readonly method: string
    readonly payload: Record<string, unknown>
  }) => void
): { readonly postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn((message: { readonly id: string; readonly method: string; readonly payload: Record<string, unknown> }) => {
    onPostMessage?.(message)
  })

  return { postMessage }
}

async function openYamlTab(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("tab", { name: "YAML" }))

  await waitFor(() => {
    expect(screen.getByRole("tab", { name: "YAML" }).getAttribute("aria-selected")).toBe("true")
  })

  const heading = await screen.findByText("Raw YAML")
  const panel = heading.closest('[role="tabpanel"]')
  if (!(panel instanceof HTMLElement)) {
    throw new Error("YAML tab panel not found")
  }

  expect(within(panel).getByRole("button", { name: "편집" })).toBeTruthy()
  return panel
}

describe("CardEditor YAML inline edit", () => {
  it("toggles edit mode and cancels without saving", async () => {
    vi.stubGlobal("acquireVsCodeApi", () => createVsCodeApiMock())

    render(<CardEditor initialData={initialData} />)

    const panel = await openYamlTab()
    const textarea = within(panel).getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.readOnly).toBe(true)

    fireEvent.click(within(panel).getByRole("button", { name: "편집" }))
    expect(textarea.readOnly).toBe(false)

    fireEvent.change(textarea, { target: { value: `${rawText}traits:\n  - 변경됨\n` } })
    fireEvent.click(within(panel).getByRole("button", { name: "취소" }))

    expect(textarea.readOnly).toBe(true)
    expect(textarea.value).toBe(rawText)
  })

  it("shows validation error when cards.writeRaw fails", async () => {
    vi.stubGlobal("acquireVsCodeApi", () =>
      createVsCodeApiMock((message) => {
        if (message.method !== "cards.writeRaw") {
          return
        }

        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "response",
              id: message.id,
              method: "cards.writeRaw",
              ok: false,
              error: { code: "invalid-yaml", message: "Card YAML을 파싱할 수 없습니다." }
            }
          })
        )
      })
    )

    render(<CardEditor initialData={initialData} />)
    const panel = await openYamlTab()
    fireEvent.click(within(panel).getByRole("button", { name: "편집" }))

    const textarea = within(panel).getByRole("textbox")
    fireEvent.change(textarea, { target: { value: "::: invalid yaml" } })
    fireEvent.click(within(panel).getByRole("button", { name: "저장" }))

    await waitFor(() => {
      expect(within(panel).getByText("Card YAML을 파싱할 수 없습니다.")).toBeTruthy()
    })
  })

  it("calls cards.writeRaw and syncs card on successful save", async () => {
    const savedCard: StoryboardCard = { ...baseCard, name: "엘리아 (수정)" }
    const savedRawText = `${rawText}name: 엘리아 (수정)\n`
    const postMessage = vi.fn((message: { readonly id: string; readonly method: string; readonly payload: Record<string, unknown> }) => {
      if (message.method !== "cards.writeRaw") {
        return
      }

      expect(message.payload).toEqual({
        uri: initialData.documentUri,
        rawText: savedRawText
      })

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "response",
            id: message.id,
            method: "cards.writeRaw",
            ok: true,
            payload: { card: savedCard, rawText: savedRawText }
          }
        })
      )
    })

    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))

    render(<CardEditor initialData={initialData} />)
    const panel = await openYamlTab()
    fireEvent.click(within(panel).getByRole("button", { name: "편집" }))

    const textarea = within(panel).getByRole("textbox")
    fireEvent.change(textarea, { target: { value: savedRawText } })
    fireEvent.click(within(panel).getByRole("button", { name: "저장" }))

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledOnce()
    })

    await waitFor(() => {
      const savedTextarea = within(panel).getByRole("textbox") as HTMLTextAreaElement
      expect(savedTextarea.value).toBe(savedRawText)
      expect(savedTextarea.readOnly).toBe(true)
    })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
