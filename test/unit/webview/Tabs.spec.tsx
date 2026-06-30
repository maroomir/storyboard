import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Star } from "lucide-react"
import React from "react"
import { afterEach, describe, expect, it } from "vitest"

import { Tabs, type TabItem } from "@webview/components/ui/Tabs"

const items: readonly TabItem[] = [
  { id: "one", label: "첫째", icon: Star, panel: <p>첫째 패널</p> },
  { id: "two", label: "둘째", icon: Star, panel: <p>둘째 패널</p> }
]

afterEach(() => {
  cleanup()
})

describe("Tabs", () => {
  it("selects the first tab and switches on click (horizontal default)", async () => {
    render(<Tabs items={items} />)

    const tablist = screen.getByRole("tablist")
    expect(tablist.getAttribute("aria-orientation")).not.toBe("vertical")
    expect(screen.getByRole("tab", { name: "첫째" }).getAttribute("aria-selected")).toBe("true")

    fireEvent.click(screen.getByRole("tab", { name: "둘째" }))

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "둘째" }).getAttribute("aria-selected")).toBe("true")
      expect(screen.getByText("둘째 패널")).toBeTruthy()
    })
  })

  it("renders a vertical icon rail when orientation is vertical", async () => {
    render(<Tabs items={items} orientation="vertical" />)

    const tablist = screen.getByRole("tablist")
    expect(tablist.getAttribute("aria-orientation")).toBe("vertical")

    const firstTab = screen.getByRole("tab", { name: "첫째" })
    expect(firstTab.querySelector("svg")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: "둘째" }))

    await waitFor(() => expect(screen.getByText("둘째 패널")).toBeTruthy())
  })
})
