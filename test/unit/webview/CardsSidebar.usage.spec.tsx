import { render, waitFor } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"

import { CardsSidebar } from "../../../webview-ui/src/components/sidebar/CardsSidebar"
import type { SidebarCardsInitialData } from "../../../webview-ui/src/lib/types"

describe("CardsSidebar usage.changed", () => {
  it("merges flat usage payload into row and header badges", async () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarCardsInitialData = {
      type: "character",
      title: "Characters",
      cards: [{ type: "character", id: "c1", name: "Alpha", uri: "file:///alpha.card" }],
      isStoryboardProject: true,
      usage: {
        scenes: {},
        characters: { c1: 0.02 },
        backgrounds: {},
        totalUsd: 0.02
      }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(document.querySelectorAll('[aria-label="예상 비용 $0.02"]')).toHaveLength(2)

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "event",
          method: "usage.changed",
          payload: {
            scenes: {},
            characters: { c1: 0.05 },
            backgrounds: {},
            totalUsd: 0.05
          }
        }
      })
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="예상 비용 $0.05"]')).toHaveLength(2)
    })

    vi.unstubAllGlobals()
  })

  it("sums multiple characters in the header badge", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarCardsInitialData = {
      type: "character",
      title: "Characters",
      cards: [
        { type: "character", id: "c1", name: "A", uri: "file:///a.card" },
        { type: "character", id: "c2", name: "B", uri: "file:///b.card" }
      ],
      isStoryboardProject: true,
      usage: {
        scenes: {},
        characters: { c1: 0.01, c2: 0.02 },
        backgrounds: {},
        totalUsd: 0.03
      }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(document.querySelector('[aria-label="예상 비용 $0.03"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="예상 비용 $0.01"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="예상 비용 $0.02"]')).toBeTruthy()

    vi.unstubAllGlobals()
  })
})
