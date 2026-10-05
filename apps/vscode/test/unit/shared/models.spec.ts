import { describe, expect, it } from "vitest"

import { aiProviderIds, isHiddenProvider, listAvailableProviderIds, providerCatalog, storyboardModelCatalog, storyboardModelPricing } from '@storyboard/story-model';
import { ConfigBridge } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';
import type { StoryboardConfigurationLike } from '@storyboard/story-ai';
describe("storyboardModelCatalog vs package.json defaults", () => {
  it("offers the current Claude models", () => {
    const claudeModelIds = storyboardModelCatalog.claude.map((option) => option.id)

    expect(claudeModelIds).toEqual(
      expect.arrayContaining(["claude-sonnet-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-haiku-4-5"])
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

  // Every provider Storyboard speaks to is billed per token now, so a missing price would make a
  // paid run look free rather than merely unknown.
  it("reaches every listed provider over http or the offline mock", () => {
    for (const providerId of listAvailableProviderIds()) {
      const entry = providerCatalog[providerId]

      expect(["http", "mock"], `${providerId} transport`).toContain(entry.transport)
    }
  })

  // The subscription CLIs left in 0.9.2 and nothing maps onto them any more. A config naming one
  // must fall through to "no provider chosen" so the author picks again — the model and the price
  // are different, so choosing on their behalf would spend money they did not agree to.
  it("keeps the retired subscription CLIs out of every list a person is shown", () => {
    for (const retiredId of ["claude-code", "codex", "gemini-cli"]) {
      expect(listAvailableProviderIds(), `${retiredId} is still listed`).not.toContain(retiredId)
    }
  })

  // The one program-run provider exists only behind a home-file switch.
  it("hides every provider that runs a program on this machine", () => {
    for (const providerId of aiProviderIds) {
      if (providerCatalog[providerId].transport === "cli") {
        expect(isHiddenProvider(providerId), `${providerId} is not hidden`).toBe(true)
      }
    }
  })

  it("keeps model ids unique inside a provider and prices paired", () => {
    for (const providerId of aiProviderIds) {
      const entry = providerCatalog[providerId]
      const ids = entry.models.map((model) => model.id)

      expect(entry.models.length, `${providerId} has no model`).toBeGreaterThan(0)
      expect(new Set(ids).size, `${providerId} repeats a model id`).toBe(ids.length)

      // A subscription login has no price: its usage must read as unpriced, never as free.
      if (entry.transport === "cli") {
        expect(storyboardModelPricing[providerId]).toEqual({})
        continue
      }

      for (const model of entry.models) {
        expect(typeof model.inputPricePerMillion, `${providerId}/${model.id} input price`).toBe("number")
        expect(typeof model.outputPricePerMillion, `${providerId}/${model.id} output price`).toBe("number")
      }
    }
  })
})
