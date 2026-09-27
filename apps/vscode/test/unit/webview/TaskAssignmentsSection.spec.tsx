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
      { name: "sceneDraft", label: "씬 드래프트" },
      { name: "grammarCheck", label: "문법 검사" },
      { name: "continuityCheck", label: "연속성 검사" }
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

function listProviderOptionValues(taskLabel: string): string[] {
  const select = screen.getByLabelText(`${taskLabel} 제공자`) as HTMLSelectElement
  return Array.from(select.options).map((option) => option.value)
}

describe("TaskAssignmentsSection", () => {
  it("leaves the developer-only mock provider out of the provider choices", () => {
    renderSection(buildSnapshot())

    const optionValues = listProviderOptionValues("씬 드래프트")
    expect(optionValues).toContain("claude")
    expect(optionValues).not.toContain("mock")
  })

  it("keeps mock selectable for a task that already uses it", () => {
    renderSection(
      buildSnapshot({
        taskAssignments: {
          sceneDraft: { providerId: "mock", model: "mock-model" },
          grammarCheck: { providerId: null, model: null },
          continuityCheck: { providerId: null, model: null }
        }
      })
    )

    expect(listProviderOptionValues("씬 드래프트")).toContain("mock")
  })

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
