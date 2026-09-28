import { describe, expect, it } from "vitest"

import { SceneGroundingPrompt, type SceneGroundingPromptInput } from "@storyboard/story-ai"

describe("SceneGroundingPrompt golden", () => {
  const full: SceneGroundingPromptInput = {
    sceneBody: "비가 내린다. 누군가 기다린다.",
    missingFields: ["incident", "place", "relation", "time"],
    characterNames: ["하나", "준"],
    knownGrounding: ["- 장소: 부두", "- 시간: 새벽"]
  }
  const single: SceneGroundingPromptInput = {
    sceneBody: "추상적인 장면",
    missingFields: ["place"],
    characterNames: [],
    knownGrounding: []
  }
  const none: SceneGroundingPromptInput = { ...single, missingFields: [] }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(SceneGroundingPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(SceneGroundingPrompt.build(single, variant)).toMatchSnapshot()
    expect(SceneGroundingPrompt.build(none, variant)).toMatchSnapshot()
    expect(SceneGroundingPrompt.build({ ...full, missingFields: ["time", "incident"] }, variant)).toMatchSnapshot()
  })
})
