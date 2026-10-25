import { describe, expect, it } from "vitest"

import {
  DIALOGUE_PRESERVED_RATIO,
  PADDING_PARAGRAPH_RATIO,
  SECTION_OUTPUT_LIMIT,
  pipelineDefaults
} from "@storyboard/story-engine"
import { integerSettingDefault } from "@storyboard/story-model"

describe("pipeline defaults data file", () => {
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
