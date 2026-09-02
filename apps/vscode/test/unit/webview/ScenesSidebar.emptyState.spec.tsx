import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ScenesSidebar } from "@webview/components/sidebar/ScenesSidebar"
import type { SidebarScenesInitialData } from "@webview/lib/types"

const emptyUsage = {
  scenes: {},
  characters: {},
  backgrounds: {},
  total: { costUsd: 0, tokens: 0, hasUnpricedUsage: false }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ScenesSidebar empty states", () => {
  it("offers to initialize the workspace when it is not a Storyboard project", () => {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    const initial: SidebarScenesInitialData = {
      title: "Scenes",
      scenes: [],
      isStoryboardProject: false,
      usage: emptyUsage
    }

    render(<ScenesSidebar initialData={initial} />)
    fireEvent.click(screen.getByRole("button", { name: "작품 초기화" }))

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: "workspace.runCommand", payload: { command: "storyboard.init" } })
    )
  })

  it("offers a new scene and seed generation when the project has no scenes", () => {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    const initial: SidebarScenesInitialData = {
      title: "Scenes",
      scenes: [],
      isStoryboardProject: true,
      usage: emptyUsage
    }

    render(<ScenesSidebar initialData={initial} />)
    fireEvent.click(screen.getByRole("button", { name: "아웃라인에서 시드 만들기" }))

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "workspace.runCommand",
        payload: { command: "storyboard.scene.generateAllSeeds" }
      })
    )
  })
})
