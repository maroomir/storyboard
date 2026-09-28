import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GenerationOptionsSection } from "@webview/components/settings/GenerationOptionsSection"
import type { SettingsReadSnapshot } from "@webview/components/settings/settingsSnapshot"

afterEach(() => {
  cleanup()
})

function createSnapshot(): SettingsReadSnapshot {
  return {
    defaultProvider: "mock",
    isDefaultProviderConfigured: true,
    providers: [],
    providerConfigs: {} as SettingsReadSnapshot["providerConfigs"],
    taskAssignments: {},
    modelCatalog: {} as SettingsReadSnapshot["modelCatalog"],
    taskCatalog: [],
    origins: { "editor.draft.keepHistory": "workspace" },
    configFiles: { user: "/home/me/.storyboard/config.json", workspace: "/work/novel/.storyboard/config.json" },
    settingCatalog: [
      {
        key: "editor.draft.keepHistory",
        label: "이전 초안 보관",
        description: "덮어쓰기 전에 남깁니다.",
        kind: "boolean",
        defaultValue: false,
        group: "생성"
      },
      {
        key: "revise.loop.maxIterations",
        label: "자동 검수 최대 반복",
        description: "몇 번까지.",
        kind: "integer",
        defaultValue: 2,
        minimum: 1,
        maximum: 5,
        group: "검수"
      }
    ],
    settingValues: { "editor.draft.keepHistory": true, "revise.loop.maxIterations": 2 }
  }
}

describe("GenerationOptionsSection", () => {
  it("renders each option with its origin and saves a toggle through the RPC", async () => {
    const callRpc = vi.fn().mockResolvedValue({ origin: "workspace", file: "/work/novel/.storyboard/config.json" })
    const onSaved = vi.fn()

    render(
      <GenerationOptionsSection snapshot={createSnapshot()} callRpc={callRpc} onRpcError={vi.fn()} onSaved={onSaved} />
    )

    expect(screen.getByText("이 작품")).toBeTruthy()
    expect(screen.getByText("기본값")).toBeTruthy()

    const toggle = screen.getByLabelText(/이전 초안 보관/) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)

    expect(callRpc).toHaveBeenCalledWith("settings.updateSettingValue", { key: "editor.draft.keepHistory", value: false })
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("이전 초안 보관", {
        origin: "workspace",
        file: "/work/novel/.storyboard/config.json"
      })
    })
  })

  it("commits a number on blur only when it changed", () => {
    const callRpc = vi.fn().mockResolvedValue({})

    render(
      <GenerationOptionsSection snapshot={createSnapshot()} callRpc={callRpc} onRpcError={vi.fn()} onSaved={vi.fn()} />
    )

    const input = screen.getByLabelText(/자동 검수 최대 반복/) as HTMLInputElement
    fireEvent.change(input, { target: { value: "2" } })
    fireEvent.blur(input)
    expect(callRpc).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "4" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(callRpc).toHaveBeenCalledWith("settings.updateSettingValue", { key: "revise.loop.maxIterations", value: 4 })
  })
})
