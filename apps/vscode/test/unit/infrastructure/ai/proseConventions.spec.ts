import { describe, expect, it } from "vitest"

import {
  SceneDialoguePolishPrompt,
  SceneSectionExpansionPrompt,
  SceneSkeletonPrompt
} from "@storyboard/story-ai"
import { createEmptyBackground } from "@storyboard/story-model"

describe("산문 규약 주입", () => {
  const background = createEmptyBackground("scene-default", "미정")

  const systems = {
    뼈대: SceneSkeletonPrompt.build({
      narrativeSource: "이준이 걷는다.",
      personas: new Map(),
      background
    }).system,
    대사다듬기: SceneDialoguePolishPrompt.build({
      skeleton: "이준이 걷는다.",
      personas: new Map()
    }).system,
    살붙임: SceneSectionExpansionPrompt.build({
      skeleton: "이준이 걷는다.",
      section: "이준이 걷는다.",
      previousSection: undefined,
      targetLength: 3000
    }).system
  }

  for (const [stage, system] of Object.entries(systems)) {
    it(`pins past tense in the ${stage} prompt`, () => {
      expect(system).toContain("과거형")
    })

    it(`pins the quotation mark style in the ${stage} prompt`, () => {
      expect(system).toContain("곡선 큰따옴표")
    })
  }
})
