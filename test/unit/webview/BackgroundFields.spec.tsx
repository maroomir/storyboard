import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackgroundFields } from "@webview/components/editor/fields/BackgroundFields"
import type { StoryboardCard } from "@webview/lib/types"

const backgroundCard: StoryboardCard = {
  type: "social",
  id: "academy",
  name: "학교 사회",
  characterIds: ["elia"]
}

const roster = [
  { id: "elia", name: "엘리아", role: "main" as const },
  { id: "jihoon", name: "지훈", role: "supporting" as const }
]

describe("BackgroundFields", () => {
  afterEach(cleanup)

  it("adds an empty related-character slot", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={{ ...backgroundCard, characterIds: [] }} updateCard={updateCard} characterRoster={roster} />)

    fireEvent.click(screen.getByLabelText("추가"))

    expect(updateCard).toHaveBeenCalledWith(expect.objectContaining({ characterIds: [""] }))
  })

  it("removes the selected related character", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={backgroundCard} updateCard={updateCard} characterRoster={roster} />)

    fireEvent.click(screen.getByLabelText("삭제"))

    expect(updateCard).toHaveBeenCalledWith(expect.objectContaining({ characterIds: [] }))
  })

  it("changes a related character to another roster entry", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={backgroundCard} updateCard={updateCard} characterRoster={roster} />)

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "jihoon" } })

    expect(updateCard).toHaveBeenCalledWith(expect.objectContaining({ characterIds: ["jihoon"] }))
  })

  it("keeps an unknown character id selectable when roster is empty", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={backgroundCard} updateCard={updateCard} characterRoster={[]} />)

    expect(screen.getByText("elia")).toBeTruthy()
  })
})
