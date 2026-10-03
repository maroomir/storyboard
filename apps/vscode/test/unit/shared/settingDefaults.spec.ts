import { describe, expect, it } from "vitest"

import { ConfigBridge, type StoryboardConfigurationLike } from "@storyboard/story-ai"
import { storyboardSettingCatalog, type StoryboardSettingDefinition } from "@storyboard/story-model"

// 설정을 읽는 접근자마다 기본값과 허용 범위를 다시 적던 시절에는 설정 화면과 실제 생성이 서로 다른
// 값을 쓰는 상태로 갈라질 수 있었다. 이 표는 카탈로그의 모든 키를 접근자에 이어 붙여, 새 설정이
// 들어오면 행을 추가하게 만들고 접근자가 카탈로그를 벗어나면 실패한다.
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
      // 장면 구분자는 구분자 사용이 꺼져 있으면 undefined 다. 그 조합은 아래에서 따로 본다.
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
