import { describe, expect, it } from "vitest"

import {
  AI_PROVIDER_IDS,
  formatResolvedTaskAi,
  parseSettingsReadSnapshot,
  pickModelForTaskProvider,
  type SettingsReadSnapshot
} from "@webview/components/settings/settingsSnapshot"

function buildValidSnapshot(): SettingsReadSnapshot {
  const providerConfigs = Object.fromEntries(
    AI_PROVIDER_IDS.map((id) => [id, { model: `${id}-model` }])
  )
  const modelCatalog = Object.fromEntries(
    AI_PROVIDER_IDS.map((id) => [id, [{ id: `${id}-model`, displayName: `${id} model` }]])
  )

  return {
    defaultProvider: "codex",
    providers: AI_PROVIDER_IDS.map((id) => ({
      providerId: id,
      displayName: id,
      hasApiKey: false,
      isAvailable: true
    })),
    providerConfigs,
    taskAssignments: { sceneDialogue: { providerId: null, model: null } },
    modelCatalog,
    taskCatalog: [{ name: "sceneDialogue", label: "장면 대사", status: "wired" }],
    origins: { defaultProvider: "user" },
    configFiles: { user: "/home/me/.storyboard/config.json" },
    settingCatalog: [
      { key: "draft.keepHistory", label: "이전 초안 보관", description: "", kind: "boolean", defaultValue: false, group: "생성" }
    ],
    settingValues: { "draft.keepHistory": false }
  } as SettingsReadSnapshot
}

describe("parseSettingsReadSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSettingsReadSnapshot(buildValidSnapshot())).toBeDefined()
  })

  it("rejects an unknown default provider", () => {
    const snapshot = { ...buildValidSnapshot(), defaultProvider: "unknown" }
    expect(parseSettingsReadSnapshot(snapshot)).toBeUndefined()
  })

  it("rejects a provider whose model catalog is empty", () => {
    const snapshot = buildValidSnapshot()
    const brokenCatalog = { ...snapshot.modelCatalog, codex: [] }
    expect(parseSettingsReadSnapshot({ ...snapshot, modelCatalog: brokenCatalog })).toBeUndefined()
  })

  it("rejects a default-provider task that still carries a model", () => {
    const snapshot = buildValidSnapshot()
    const taskAssignments = { sceneDialogue: { providerId: null, model: "codex-model" } }
    expect(parseSettingsReadSnapshot({ ...snapshot, taskAssignments })).toBeUndefined()
  })
})

describe("pickModelForTaskProvider", () => {
  it("keeps a preferred model when it is in the catalog", () => {
    const snapshot = buildValidSnapshot()
    expect(pickModelForTaskProvider(snapshot, "codex", "codex-model")).toBe("codex-model")
  })

  it("falls back to the catalog head when the preferred model is unknown", () => {
    const snapshot = buildValidSnapshot()
    expect(pickModelForTaskProvider(snapshot, "codex", "ghost-model")).toBe("codex-model")
  })
})

describe("formatResolvedTaskAi", () => {
  it("resolves a default-provider task to the default provider and its model", () => {
    const snapshot = buildValidSnapshot()
    expect(formatResolvedTaskAi(snapshot, "sceneDialogue")).toBe("codex / codex model")
  })
})
