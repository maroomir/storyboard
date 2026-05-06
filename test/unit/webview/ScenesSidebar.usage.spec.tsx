import { render, waitFor } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"

import { ScenesSidebar } from "../../../webview-ui/src/components/sidebar/ScenesSidebar"
import type { SidebarScenesInitialData } from "../../../webview-ui/src/lib/types"

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
        scenes: { "001_intro": 0.02 },
        characters: {},
        backgrounds: {},
        totalUsd: 0.02
      }
    }

    render(<ScenesSidebar initialData={initial} />)

    expect(document.querySelectorAll('[aria-label="예상 비용 $0.02"]')).toHaveLength(2)

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "event",
          method: "usage.changed",
          payload: {
            scenes: { "001_intro": 0.07 },
            characters: {},
            backgrounds: {},
            totalUsd: 0.07
          }
        }
      })
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[aria-label="예상 비용 $0.07"]')).toHaveLength(2)
    })

    vi.unstubAllGlobals()
  })
})
