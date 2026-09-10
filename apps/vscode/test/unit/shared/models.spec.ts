import { describe, expect, it } from "vitest"

import {
  aiProviderIds,
  cliProviderIds,
  ConfigBridge,
  providerCatalog,
  storyboardModelCatalog,
} from '@storyboard/story-ai';
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

// The catalog is one table now, so what used to be spread over several files is an internal
// consistency question: a typo in one column must fail here rather than at generation time.
describe("providerCatalog internal consistency", () => {
  it("lists a default model that the provider actually offers", () => {
    for (const providerId of aiProviderIds) {
      const entry = providerCatalog[providerId]
      if (entry.defaultModel === undefined) {
        continue
      }

      const ids = entry.models.map((model) => model.id)
      expect(ids, `${providerId} default is not in its model list`).toContain(entry.defaultModel)
    }
  })

  it("gives every CLI provider a command and no other provider one", () => {
    for (const providerId of aiProviderIds) {
      const entry = providerCatalog[providerId]
      const isCli = (cliProviderIds as readonly string[]).includes(providerId)

      expect(entry.transport === "cli", `${providerId} transport disagrees with cliProviderIds`).toBe(isCli)
      expect(typeof entry.defaultCommand === "string", `${providerId} command`).toBe(isCli)
    }
  })

  it("keeps retired model ids out of the offered models", () => {
    for (const providerId of aiProviderIds) {
      const entry = providerCatalog[providerId]
      const ids = entry.models.map((model) => model.id)

      for (const retired of entry.retiredModelIds) {
        expect(ids, `${providerId} still offers retired ${retired}`).not.toContain(retired)
      }
    }
  })

  it("keeps model ids unique inside a provider and prices paired", () => {
    for (const providerId of aiProviderIds) {
      const entry = providerCatalog[providerId]
      const ids = entry.models.map((model) => model.id)

      expect(entry.models.length, `${providerId} has no model`).toBeGreaterThan(0)
      expect(new Set(ids).size, `${providerId} repeats a model id`).toBe(ids.length)

      for (const model of entry.models) {
        expect(
          (model.inputPricePerMillion === undefined) === (model.outputPricePerMillion === undefined),
          `${providerId}/${model.id} prices only one direction`
        ).toBe(true)
      }
    }
  })
})
