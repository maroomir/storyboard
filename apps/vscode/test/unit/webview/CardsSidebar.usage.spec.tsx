import { cleanup, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardsSidebar } from "@webview/components/sidebar/CardsSidebar"
import { groupCharacterCardsByRole } from "@webview/lib/characterSidebarGroups"
import type { SidebarCardsInitialData } from "@webview/lib/types"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
        characters: { c1: { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false } },
        backgrounds: {},
        total: { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false }
      }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(document.querySelectorAll('[aria-label="AI 사용량 $0.02"]')).toHaveLength(2)

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "event",
          method: "usage.changed",
          payload: {
            scenes: {},
            characters: { c1: { costUsd: 0.05, tokens: 0, hasUnpricedUsage: false } },
            backgrounds: {},
            total: { costUsd: 0.05, tokens: 0, hasUnpricedUsage: false }
          }
        }
      })
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="AI 사용량 $0.05"]')).toHaveLength(2)
    })

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
        characters: { c1: { costUsd: 0.01, tokens: 0, hasUnpricedUsage: false }, c2: { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false } },
        backgrounds: {},
        total: { costUsd: 0.03, tokens: 0, hasUnpricedUsage: false }
      }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(document.querySelector('[aria-label="AI 사용량 $0.03"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="AI 사용량 $0.01"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="AI 사용량 $0.02"]')).toBeTruthy()
  })
})

describe("CardsSidebar character role grouping", () => {
  it("groups characters into collapsible 주연/조연/엑스트라 sections", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarCardsInitialData = {
      type: "character",
      title: "Characters",
      cards: [
        { type: "character", id: "extra1", name: "행인", uri: "file:///extra.card", role: "extra" },
        { type: "character", id: "main1", name: "주인공", uri: "file:///main.card", role: "main" },
        { type: "character", id: "sup1", name: "이서준", uri: "file:///sup.card", role: "supporting" }
      ],
      isStoryboardProject: true,
      usage: { scenes: {}, characters: {}, backgrounds: {}, total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false } }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(screen.getByText("주연")).toBeTruthy()
    expect(screen.getByText("조연")).toBeTruthy()
    expect(screen.getByText("엑스트라")).toBeTruthy()
    expect(screen.getByText("주인공")).toBeTruthy()
    expect(screen.getByText("이서준")).toBeTruthy()
    expect(screen.getByText("행인")).toBeTruthy()
    expect(screen.queryByText("미분류")).toBeNull()
  })

  it("places cards without role in the 미분류 section", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarCardsInitialData = {
      type: "character",
      title: "Characters",
      cards: [
        { type: "character", id: "main1", name: "주인공", uri: "file:///main.card", role: "main" },
        { type: "character", id: "orphan", name: "미지정", uri: "file:///orphan.card" }
      ],
      isStoryboardProject: true,
      usage: { scenes: {}, characters: {}, backgrounds: {}, total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false } }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(screen.getByText("미분류")).toBeTruthy()
    expect(screen.getByText("미지정")).toBeTruthy()
  })

  it("keeps background sidebar as a flat list without role sections", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarCardsInitialData = {
      type: "background",
      title: "Backgrounds",
      cards: [
        { type: "location", id: "loc1", name: "교실", uri: "file:///loc.card" },
        { type: "location", id: "loc2", name: "운동장", uri: "file:///yard.card" }
      ],
      isStoryboardProject: true,
      usage: { scenes: {}, characters: {}, backgrounds: {}, total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false } }
    }

    render(<CardsSidebar initialData={initial} />)

    expect(screen.queryByText("주연")).toBeNull()
    expect(screen.queryByText("미분류")).toBeNull()
    expect(screen.getByText("교실")).toBeTruthy()
    expect(screen.getByText("운동장")).toBeTruthy()
  })

  it("sorts cards within each role group using Korean locale", () => {
    const sections = groupCharacterCardsByRole([
      { type: "character", id: "b", name: "바", uri: "file:///b.card", role: "main" },
      { type: "character", id: "a", name: "가", uri: "file:///a.card", role: "main" }
    ])

    expect(sections).toHaveLength(1)
    expect(sections[0]?.label).toBe("주연")
    expect(sections[0]?.cards.map((card) => card.name)).toEqual(["가", "바"])
  })
})
