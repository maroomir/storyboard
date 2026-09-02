import { describe, expect, it } from "vitest"

import { aiProviderIds, ConfigBridge, storyboardModelCatalog } from '@storyboard/story-ai';
import type { AiProviderId, StoryboardConfigurationLike } from '@storyboard/story-ai';
describe("storyboardModelCatalog vs package.json defaults", () => {
  it("includes every GPT-5.6 Codex model", () => {
    const codexModelIds = storyboardModelCatalog.codex.map((option) => option.id)

    expect(codexModelIds).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
    )
  })

  // The extension contributes no VSCode configuration any more, so the defaults the bridge falls
  // back to are the only ones there are — every one of them must be a catalog model.
  it("includes every provider model default the ConfigBridge falls back to", () => {
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => ({
        get: <T>(_section: string, defaultValue: T): T => defaultValue
      })
    })

    for (const providerId of aiProviderIds) {
      if (providerId === "mock") {
        continue
      }

      const defaultModel = configBridge.getProviderConfig(providerId).model
      expect(typeof defaultModel, `missing default for ${providerId}`).toBe("string")
      const ids = storyboardModelCatalog[providerId as AiProviderId].map((o) => o.id)
      expect(ids).toContain(defaultModel)
    }
  })
})
