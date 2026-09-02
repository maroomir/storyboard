import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsSummaryCards } from "@webview/components/settings/SettingsSummaryCards"
import { AI_PROVIDER_IDS, type SettingsReadSnapshot } from "@webview/components/settings/settingsSnapshot"

function buildSnapshot(): SettingsReadSnapshot {
  const providerConfigs = Object.fromEntries(AI_PROVIDER_IDS.map((id) => [id, { model: `${id}-model` }]))
  const modelCatalog = Object.fromEntries(
    AI_PROVIDER_IDS.map((id) => [id, [{ id: `${id}-model`, displayName: `${id} 모델` }]])
  )

  return {
    defaultProvider: "claude",
    isDefaultProviderConfigured: true,
    providers: AI_PROVIDER_IDS.map((id) => ({
      providerId: id,
      displayName: id,
      hasApiKey: id === "claude",
      isAvailable: true
    })),
    providerConfigs,
    modelCatalog,
    taskAssignments: {
      sceneDraft: { providerId: "codex", model: "codex-model" },
      grammarCheck: { providerId: null, model: null }
    },
    taskCatalog: [
      { name: "sceneDraft", label: "씬 드래프트", status: "wired" },
      { name: "grammarCheck", label: "문법 검사", status: "wired" }
    ]
  } as SettingsReadSnapshot
}

afterEach(() => {
  cleanup()
})

describe("SettingsSummaryCards", () => {
  it("summarizes the default AI, key registrations, and override counts", () => {
    render(<SettingsSummaryCards snapshot={buildSnapshot()} onNavigate={vi.fn()} />)

    expect(screen.getByText("claude 모델")).toBeTruthy()
    expect(screen.getByText("1 / 3 키 등록")).toBeTruthy()
    expect(screen.getByText("1개 활성")).toBeTruthy()
    expect(screen.getByText("나머지 1개는 기본값")).toBeTruthy()
  })

  it("navigates to the matching tab from each card", () => {
    const onNavigate = vi.fn()
    render(<SettingsSummaryCards snapshot={buildSnapshot()} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole("button", { name: "변경 ›" }))
    fireEvent.click(screen.getByRole("button", { name: "연결 관리 ›" }))
    fireEvent.click(screen.getByRole("button", { name: "오버라이드 관리 ›" }))

    expect(onNavigate.mock.calls.map((call) => call[0])).toEqual(["defaults", "connections", "tasks"])
  })
})
