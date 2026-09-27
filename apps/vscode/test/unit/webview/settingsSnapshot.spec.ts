import { describe, expect, it } from "vitest"

import { aiProviderIds, requiresApiKey as engineRequiresApiKey } from "@storyboard/story-ai"

import {
  AI_PROVIDER_IDS,
  formatResolvedTaskAi,
  parseSettingsReadSnapshot,
  pickModelForTaskProvider,
  requiresApiKey,
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
    defaultProvider: "claude",
    isDefaultProviderConfigured: true,
    providers: AI_PROVIDER_IDS.map((id) => ({
      providerId: id,
      displayName: id,
      hasApiKey: false,
      isAvailable: true
    })),
    providerConfigs,
    taskAssignments: { sceneDialogue: { providerId: null, model: null } },
    modelCatalog,
    taskCatalog: [{ name: "sceneDialogue", label: "장면 대사" }],
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
    const brokenCatalog = { ...snapshot.modelCatalog, claude: [] }
    expect(parseSettingsReadSnapshot({ ...snapshot, modelCatalog: brokenCatalog })).toBeUndefined()
  })

  it("rejects a default-provider task that still carries a model", () => {
    const snapshot = buildValidSnapshot()
    const taskAssignments = { sceneDialogue: { providerId: null, model: "claude-model" } }
    expect(parseSettingsReadSnapshot({ ...snapshot, taskAssignments })).toBeUndefined()
  })
})

describe("pickModelForTaskProvider", () => {
  it("keeps a preferred model when it is in the catalog", () => {
    const snapshot = buildValidSnapshot()
    expect(pickModelForTaskProvider(snapshot, "claude", "claude-model")).toBe("claude-model")
  })

  it("falls back to the catalog head when the preferred model is unknown", () => {
    const snapshot = buildValidSnapshot()
    expect(pickModelForTaskProvider(snapshot, "claude", "ghost-model")).toBe("claude-model")
  })
})

describe("formatResolvedTaskAi", () => {
  it("resolves a default-provider task to the default provider and its model", () => {
    const snapshot = buildValidSnapshot()
    expect(formatResolvedTaskAi(snapshot, "sceneDialogue")).toBe("claude / claude model")
  })

  // 웹뷰는 이 목록을 직접 계약에서 읽으므로 사본 대조는 더 이상 의미가 없다. 대신 계약이 실제로
  // 브라우저 번들에 닿는지를 확인한다.
  describe("provider lists read straight from the contract", () => {
    it("reaches the settings panel with every provider the engine knows", () => {
      expect([...AI_PROVIDER_IDS]).toEqual([...aiProviderIds])
    })

    it("agrees with the engine on which providers need an API key", () => {
      for (const providerId of aiProviderIds) {
        expect(requiresApiKey(providerId)).toBe(engineRequiresApiKey(providerId))
      }
    })

  })
})
