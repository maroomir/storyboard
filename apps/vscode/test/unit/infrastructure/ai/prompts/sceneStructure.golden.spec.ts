import { describe, expect, it } from "vitest"

import { SceneStructurePrompt, type SceneStructurePromptInput } from "@storyboard/story-ai"

describe("SceneStructurePrompt golden", () => {
  const full: SceneStructurePromptInput = {
    sceneSummary: "하나가 준에게 편지를 건네고, 준은 그 자리에서 찢는다.",
    missingFields: ["purpose", "conflict", "twist", "emotionalShift", "endState", "foreshadowing", "neededCanon"],
    knownFields: ["- 목적: 화해 시도", "- 갈등: 자존심"]
  }
  const single: SceneStructurePromptInput = { sceneSummary: "짧은 요약", missingFields: ["endState"], knownFields: [] }
  const none: SceneStructurePromptInput = { ...single, missingFields: [] }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneStructurePrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneStructurePrompt.build(single, variant)).toMatchSnapshot()
    expect(SceneStructurePrompt.build(none, variant)).toMatchSnapshot()
    expect(SceneStructurePrompt.build({ ...full, missingFields: ["neededCanon", "purpose"] }, variant)).toMatchSnapshot()
  })
})
