import { render, waitFor } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"

import { ScenesSidebar } from "@webview/components/sidebar/ScenesSidebar"
import type { SidebarScenesInitialData } from "@webview/lib/types"

describe("ScenesSidebar usage.changed", () => {
  it("merges flat usage payload into scene and header badges", async () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarScenesInitialData = {
      title: "Scenes",
      scenes: [
        {
          stem: "001_intro",
          order: 1,
          slug: "intro",
          sceneUri: "file:///001_intro.txt",
          status: "ready",
          sceneMtime: 1
        }
      ],
      isStoryboardProject: true,
      usage: {
        scenes: { "001_intro": { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false } },
        characters: {},
        backgrounds: {},
        total: { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false }
      }
    }

    render(<ScenesSidebar initialData={initial} />)

    expect(document.querySelectorAll('[aria-label="AI 사용량 $0.02"]')).toHaveLength(2)

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "event",
          method: "usage.changed",
          payload: {
            scenes: { "001_intro": { costUsd: 0.07, tokens: 0, hasUnpricedUsage: false } },
            characters: {},
            backgrounds: {},
            total: { costUsd: 0.07, tokens: 0, hasUnpricedUsage: false }
          }
        }
      })
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="AI 사용량 $0.07"]')).toHaveLength(2)
    })

    vi.unstubAllGlobals()
  })

  // 머리 배지는 씬 합계만 더해, 아웃라인·요약·검수처럼 작품에 귀속된 비용이 어디에도 보이지 않았다.
  it("shows the work's whole spend in the header badge, scenes alone on the scene", async () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))

    const initial: SidebarScenesInitialData = {
      title: "Scenes",
      scenes: [
        {
          stem: "001_intro",
          order: 1,
          slug: "intro",
          sceneUri: "file:///001_intro.txt",
          status: "ready",
          sceneMtime: 1
        }
      ],
      isStoryboardProject: true,
      usage: {
        scenes: { "001_intro": { costUsd: 0.02, tokens: 0, hasUnpricedUsage: false } },
        characters: {},
        backgrounds: {},
        total: { costUsd: 0.09, tokens: 0, hasUnpricedUsage: false }
      }
    }

    render(<ScenesSidebar initialData={initial} />)

    const header = document.querySelector('[aria-label="AI 사용량 $0.09"]')
    expect(header?.getAttribute("title")).toBe("작품 전체 · USD 0.090000 · 입력+출력 0 토큰 · 씬 $0.02")
    expect(document.querySelectorAll('[aria-label="AI 사용량 $0.02"]')).toHaveLength(1)

    vi.unstubAllGlobals()
  })
})
