import { describe, expect, it } from "vitest"

import { ConfigBridge, type StoryboardConfigurationLike } from "@storyboard/story-ai"
import { storyboardSettingCatalog, type StoryboardSettingDefinition } from "@storyboard/story-model"

const readers: Readonly<Record<string, (bridge: ConfigBridge) => boolean | number | string | undefined>> = {
  "revise.loop.afterGenerate": (bridge) => bridge.isReviseAfterGenerateEnabled(),
  "revise.loop.maxIterations": (bridge) => bridge.getReviseMaxIterations(),
  "revise.loop.scoreThreshold": (bridge) => bridge.getReviseScoreThreshold(),
  "revise.length.maxCompressionPercent": (bridge) => bridge.getMaxCompressionPercent(),
  "cards.candidates.updateAfterGenerate": (bridge) => bridge.isUpdateCardsAfterGenerateEnabled(),
  "cards.candidates.verify": (bridge) => bridge.isVerifyCardCandidatesEnabled(),
  "budget.run.limitUsd": (bridge) => bridge.getRunBudgetUsd(),
  "generation.grounding.autoApprove": (bridge) => bridge.isSceneGroundingAutoApproveEnabled(),
  "generation.beats.auto": (bridge) => bridge.isAutoBeatsEnabled(),
  "generation.beats.charsPerBeat": (bridge) => bridge.getCharsPerBeat(),
  "generation.section.outputLimit": (bridge) => bridge.getSectionOutputLimit(),
  "generation.beats.minimum": (bridge) => bridge.getMinBeats(),
  "editor.draft.keepHistory": (bridge) => bridge.isKeepDraftHistoryEnabled(),
  "generation.sceneBreak.enabled": (bridge) => bridge.getDraftSceneBreakSeparator() !== undefined,
  "generation.sceneBreak.separator": (bridge) => bridge.getDraftSceneBreakSeparator(),
  "generation.context.condense": (bridge) => bridge.isAiContextCondenseEnabled(),
  "editor.scene.prefixDigits": (bridge) => bridge.getScenePrefixDigits(),
  "editor.studio.validation": (bridge) => bridge.isStudioValidationEnabled(),
  "editor.grammar.realtime": (bridge) => bridge.isGrammarRealtimeEnabled(),
  "editor.slop.realtime": (bridge) => bridge.isSlopRealtimeEnabled()
}

function bridgeReading(values: Readonly<Record<string, unknown>>): ConfigBridge {
  return new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike => ({
      get: <T,>(section: string, defaultValue: T): T =>
        (values[section] as T | undefined) ?? defaultValue
    })
  })
}

const integerSettings = storyboardSettingCatalog.filter(
  (definition): definition is StoryboardSettingDefinition => definition.kind === "integer"
)

describe("ConfigBridge against the setting catalog", () => {
  it("covers every catalogued setting", () => {
    expect(Object.keys(readers).sort()).toEqual(
      storyboardSettingCatalog.map((definition) => definition.key).sort()
    )
  })

  it("returns the catalogued default when nothing is configured", () => {
    const bridge = bridgeReading({})

    for (const definition of storyboardSettingCatalog) {
      if (definition.key === "generation.sceneBreak.separator") {
        continue
      }

      expect(readers[definition.key]?.(bridge), definition.key).toBe(definition.defaultValue)
    }
  })

  it("clamps an out-of-range integer to the catalogued bounds", () => {
    for (const definition of integerSettings) {
      const belowBridge = bridgeReading({ [definition.key]: -1_000_000 })
      const aboveBridge = bridgeReading({ [definition.key]: 1_000_000 })

      expect(readers[definition.key]?.(belowBridge), `${definition.key} floor`).toBe(
        definition.minimum
      )
      expect(readers[definition.key]?.(aboveBridge), `${definition.key} ceiling`).toBe(
        definition.maximum
      )
    }
  })

  it("hands back the catalogued separator once scene breaks are on", () => {
    const bridge = bridgeReading({ "generation.sceneBreak.enabled": true })

    expect(bridge.getDraftSceneBreakSeparator()).toBe("---")
  })
})
