import { describe, expect, it } from "vitest"

import {
  legacyVscodeSettingKeys,
  migrateVscodeSettingsToHome,
  type LegacyVscodeConfigurationLike
} from "@/infrastructure/settings/migrateVscodeSettings"
import type { StoryboardConfigurationLike, StoryboardSecretStorageLike } from "@storyboard/story-ai"

interface Layers {
  user: Map<string, unknown>
  workspace: Map<string, unknown>
}

function createLegacyConfiguration(layers: Layers): LegacyVscodeConfigurationLike {
  return {
    inspect: <T>(section: string): { globalValue?: T; workspaceValue?: T } => ({
      globalValue: layers.user.get(section) as T | undefined,
      workspaceValue: layers.workspace.get(section) as T | undefined
    }),
    update: async (section, _value, target): Promise<void> => {
      const layer = target === 2 ? layers.workspace : layers.user
      layer.delete(section)
    }
  }
}

function createHomeConfiguration(layers: Layers): StoryboardConfigurationLike {
  return {
    get: <T>(section: string, defaultValue: T): T =>
      (layers.workspace.get(section) ?? layers.user.get(section) ?? defaultValue) as T,
    inspect: <T>(section: string): { globalValue?: T; workspaceValue?: T } => ({
      globalValue: layers.user.get(section) as T | undefined,
      workspaceValue: layers.workspace.get(section) as T | undefined
    }),
    update: async (section, value, target): Promise<void> => {
      const layer = target === 2 ? layers.workspace : layers.user
      layer.set(section, value)
    }
  }
}

function createSecrets(initial: Record<string, string>): StoryboardSecretStorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: async (key) => values.get(key),
    store: async (key, value): Promise<void> => {
      values.set(key, value)
    },
    delete: async (key): Promise<void> => {
      values.delete(key)
    }
  }
}

describe("migrateVscodeSettingsToHome", () => {
  it("copies each scope into the matching config layer and clears the VSCode value", async () => {
    const legacy: Layers = {
      user: new Map<string, unknown>([["defaultProvider", "codex"], ["tasks", { sceneDraft: { provider: "codex" } }]]),
      workspace: new Map<string, unknown>([["draft.keepHistory", true]])
    }
    const home: Layers = { user: new Map(), workspace: new Map() }

    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: createLegacyConfiguration(legacy),
      vscodeSecrets: createSecrets({}),
      homeConfiguration: createHomeConfiguration(home),
      homeSecrets: createSecrets({}),
      hasWorkspaceConfigFile: true
    })

    expect(result.movedSettings).toEqual(["ai.provider.default", "tasks", "editor.draft.keepHistory"])
    expect(home.user.get("ai.provider.default")).toBe("codex")
    expect(home.user.get("tasks")).toEqual({ sceneDraft: { provider: "codex" } })
    expect(home.workspace.get("editor.draft.keepHistory")).toBe(true)
    expect(legacy.user.size).toBe(0)
    expect(legacy.workspace.size).toBe(0)
  })

  // A value the author already put in the shared file after the move is the newer one; the stale
  // VSCode copy is still cleared so it cannot resurface.
  it("keeps an existing config.json value over the legacy one", async () => {
    const legacy: Layers = { user: new Map([["defaultProvider", "mock"]]), workspace: new Map() }
    const home: Layers = { user: new Map([["ai.provider.default", "claude-code"]]), workspace: new Map() }

    await migrateVscodeSettingsToHome({
      vscodeConfiguration: createLegacyConfiguration(legacy),
      vscodeSecrets: createSecrets({}),
      homeConfiguration: createHomeConfiguration(home),
      homeSecrets: createSecrets({}),
      hasWorkspaceConfigFile: false
    })

    expect(home.user.get("ai.provider.default")).toBe("claude-code")
    expect(legacy.user.has("defaultProvider")).toBe(false)
  })

  it("leaves workspace-scoped values alone when there is no workspace to write to", async () => {
    const legacy: Layers = { user: new Map(), workspace: new Map([["draft.keepHistory", true]]) }
    const home: Layers = { user: new Map(), workspace: new Map() }

    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: createLegacyConfiguration(legacy),
      vscodeSecrets: createSecrets({}),
      homeConfiguration: createHomeConfiguration(home),
      homeSecrets: createSecrets({}),
      hasWorkspaceConfigFile: false
    })

    expect(result.movedSettings).toEqual([])
    expect(legacy.workspace.get("draft.keepHistory")).toBe(true)
  })

  it("moves API keys out of VSCode secret storage without overwriting the shared file", async () => {
    const vscodeSecrets = createSecrets({
      "storyboard.apiKey.openai": "sk-old",
      "storyboard.apiKey.claude": "ck-legacy"
    })
    const homeSecrets = createSecrets({ "storyboard.apiKey.claude": "ck-shared" })

    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: createLegacyConfiguration({ user: new Map(), workspace: new Map() }),
      vscodeSecrets,
      homeConfiguration: createHomeConfiguration({ user: new Map(), workspace: new Map() }),
      homeSecrets,
      hasWorkspaceConfigFile: false
    })

    expect(result.movedApiKeys).toEqual(["openai", "claude"])
    expect(homeSecrets.values.get("storyboard.apiKey.openai")).toBe("sk-old")
    expect(homeSecrets.values.get("storyboard.apiKey.claude")).toBe("ck-shared")
    expect(vscodeSecrets.values.size).toBe(0)
  })

  it("reports nothing to move on a clean install", async () => {
    const result = await migrateVscodeSettingsToHome({
      vscodeConfiguration: createLegacyConfiguration({ user: new Map(), workspace: new Map() }),
      vscodeSecrets: createSecrets({}),
      homeConfiguration: createHomeConfiguration({ user: new Map(), workspace: new Map() }),
      homeSecrets: createSecrets({}),
      hasWorkspaceConfigFile: true
    })

    expect(result).toEqual({ movedSettings: [], movedApiKeys: [] })
  })

  it("lists every key the extension used to contribute", () => {
    expect(legacyVscodeSettingKeys).toContain("defaultProvider")
    expect(legacyVscodeSettingKeys).toContain("draft.sceneBreakSeparator")
    expect(new Set(legacyVscodeSettingKeys).size).toBe(legacyVscodeSettingKeys.length)
  })
})
