import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BackgroundFields } from "@webview/components/editor/fields/BackgroundFields"
import type { StoryboardCard } from "@webview/lib/types"

const locationCard: StoryboardCard = {
  type: "location",
  id: "school",
  name: "학교 정문",
  locationKind: "place"
}

describe("BackgroundFields", () => {
  afterEach(cleanup)

  it("updates the location kind for location cards", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={locationCard} updateCard={updateCard} />)

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "affiliation" } })

    expect(updateCard).toHaveBeenCalledWith(expect.objectContaining({ locationKind: "affiliation" }))
  })

  it("does not render related-character inputs", () => {
    const updateCard = vi.fn()
    render(<BackgroundFields card={{ type: "social", id: "academy", name: "학교 사회" }} updateCard={updateCard} />)

    expect(screen.queryByText("Related Characters")).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})
