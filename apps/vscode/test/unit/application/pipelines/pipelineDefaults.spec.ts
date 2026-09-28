import { describe, expect, it } from "vitest"

import {
  DIALOGUE_PRESERVED_RATIO,
  PADDING_PARAGRAPH_RATIO,
  SECTION_OUTPUT_LIMIT,
  pipelineDefaults
} from "@storyboard/story-pipeline"
import { integerSettingDefault } from "@storyboard/story-ai"

describe("pipeline defaults data file", () => {
  // 1/3 은 JSON 으로 적을 수 없어 가장 가까운 배정도 값을 적었다. 누가 자릿수를 줄이면 뼈대 분량이
  // 조용히 달라지므로 여기서 막는다.
  it("keeps the skeleton ratio exactly one third", () => {
    expect(pipelineDefaults.skeleton.lengthRatio).toBe(1 / 3)
  })

  it("takes the section output limit from the setting catalog, not its own copy", () => {
    expect(SECTION_OUTPUT_LIMIT).toBe(integerSettingDefault("generation.section.outputLimit"))
  })

  it("feeds the exported thresholds from the data file", () => {
    expect(DIALOGUE_PRESERVED_RATIO).toBe(pipelineDefaults.dialogue.preservedRatio)
    expect(PADDING_PARAGRAPH_RATIO).toBe(pipelineDefaults.padding.paragraphRatio)
  })

  // 되풀이 판정은 창보다 누적 한도가 커야 뜻이 있다. 두 값을 따로 고치다 뒤집히면 모든 구간이
  // 위반으로 잡힌다.
  it("keeps the repeated-run limit above one comparison window", () => {
    expect(pipelineDefaults.section.repeatedRunLimit).toBeGreaterThan(
      pipelineDefaults.section.repeatedRunWindow
    )
  })

  it("keeps voice sample bounds ordered", () => {
    expect(pipelineDefaults.voiceSamples.maximumLength).toBeGreaterThan(
      pipelineDefaults.voiceSamples.minimumLength
    )
  })
})
