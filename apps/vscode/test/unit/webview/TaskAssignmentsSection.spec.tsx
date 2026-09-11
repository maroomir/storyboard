import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskAssignmentsSection } from "@webview/components/settings/TaskAssignmentsSection"
import { AI_PROVIDER_IDS, type SettingsReadSnapshot } from "@webview/components/settings/settingsSnapshot"

function buildSnapshot(overrides: Partial<SettingsReadSnapshot> = {}): SettingsReadSnapshot {
  const providerConfigs = Object.fromEntries(AI_PROVIDER_IDS.map((id) => [id, { model: `${id}-model` }]))
  const modelCatalog = Object.fromEntries(
    AI_PROVIDER_IDS.map((id) => [id, [{ id: `${id}-model`, displayName: `${id} model` }]])
  )

  return {
    defaultProvider: "claude",
    providers: AI_PROVIDER_IDS.map((id) => ({ providerId: id, displayName: id, hasApiKey: false, isAvailable: true })),
    providerConfigs,
    modelCatalog,
    taskAssignments: {
      sceneDraft: { providerId: "claude", model: "claude-model" },
      grammarCheck: { providerId: null, model: null },
      continuityCheck: { providerId: null, model: null }
    },
    taskCatalog: [
      { name: "sceneDraft", label: "씬 드래프트", status: "wired" },
      { name: "grammarCheck", label: "문법 검사", status: "wired" },
      { name: "continuityCheck", label: "연속성 검사", status: "planned" }
    ],
    ...overrides
  } as SettingsReadSnapshot
}

function renderSection(snapshot: SettingsReadSnapshot): { readonly callRpc: ReturnType<typeof vi.fn> } {
  const callRpc = vi.fn().mockResolvedValue({})
  render(<TaskAssignmentsSection snapshot={snapshot} callRpc={callRpc} onRpcError={vi.fn()} />)
  return { callRpc }
}

afterEach(() => {
  cleanup()
})

describe("TaskAssignmentsSection", () => {
  it("lists only overridden tasks", () => {
    renderSection(buildSnapshot())

    expect(screen.getByText("씬 드래프트")).toBeTruthy()
    expect(screen.queryByText("문법 검사")).toBeNull()
    expect(screen.getByText("1 / 3개 태스크")).toBeTruthy()
  })

  it("explains the empty state when nothing is overridden", () => {
    const snapshot = buildSnapshot({
      taskAssignments: {
        sceneDraft: { providerId: null, model: null },
        grammarCheck: { providerId: null, model: null },
        continuityCheck: { providerId: null, model: null }
      }
    })
    renderSection(snapshot)

    expect(screen.getByText(/활성 오버라이드가 없습니다/)).toBeTruthy()
  })

  it("clears the assignment when an override is removed", () => {
    const { callRpc } = renderSection(buildSnapshot())

    fireEvent.click(screen.getByRole("button", { name: "씬 드래프트 오버라이드 제거" }))

    expect(callRpc).toHaveBeenCalledWith("settings.updateTaskAiConfig", {
      taskName: "sceneDraft",
      providerId: null,
      model: null
    })
  })

  it("adds an override on the default provider from the picker", () => {
    const { callRpc } = renderSection(buildSnapshot())

    fireEvent.click(screen.getByRole("button", { name: "＋ 태스크 오버라이드 추가" }))
    fireEvent.click(screen.getByRole("button", { name: /문법 검사/ }))

    expect(callRpc).toHaveBeenCalledWith("settings.updateTaskAiConfig", {
      taskName: "grammarCheck",
      providerId: "claude",
      model: "claude-model"
    })
  })

  it("keeps planned tasks out of the picker", () => {
    renderSection(buildSnapshot())

    fireEvent.click(screen.getByRole("button", { name: "＋ 태스크 오버라이드 추가" }))

    expect(screen.queryByRole("button", { name: /연속성 검사/ })).toBeNull()
    expect(screen.getByText("Phase 6 예정 1개는 아직 오버라이드할 수 없습니다.")).toBeTruthy()
  })

  it("filters the picker by the search query", () => {
    renderSection(
      buildSnapshot({
        taskAssignments: {
          sceneDraft: { providerId: null, model: null },
          grammarCheck: { providerId: null, model: null },
          continuityCheck: { providerId: null, model: null }
        }
      })
    )

    fireEvent.click(screen.getByRole("button", { name: "＋ 태스크 오버라이드 추가" }))
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "문법" } })

    expect(screen.getByRole("button", { name: /문법 검사/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /씬 드래프트/ })).toBeNull()
  })
})
