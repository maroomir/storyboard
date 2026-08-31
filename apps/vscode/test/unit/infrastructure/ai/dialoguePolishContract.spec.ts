import { describe, expect, it } from "vitest"

import {
  SceneDialoguePolishPrompt,
  SceneSkeletonPrompt,
  StoryStateUpdatePrompt
} from "@storyboard/story-ai"
import { createEmptyBackground } from "@storyboard/story-format"

const personas = new Map([["서하", '나는 서하다. "추출 뒤에는 되돌릴 수 없습니다."']])

describe("대사 다듬기 계약", () => {
  const system = SceneDialoguePolishPrompt.build({ skeleton: "서하가 말한다.", personas }).system

  it("forbids inventing turns instead of asking for more of them", () => {
    expect(system).toContain("대사의 개수와 순서는 뼈대 그대로")
    expect(system).not.toContain("되묻거나 받아치게")
  })

  it("names the empty restatement turn as the pattern to avoid", () => {
    expect(system).toContain("의문형으로 되풀이하는 턴")
  })
})

describe("페르소나 예시 대사 재사용 금지", () => {
  const background = createEmptyBackground("scene-default", "미정")
  const stages = {
    뼈대: SceneSkeletonPrompt.build({ narrativeSource: "서하가 말한다.", personas, background })
      .system,
    대사다듬기: SceneDialoguePolishPrompt.build({ skeleton: "서하가 말한다.", personas }).system
  }

  for (const [stage, system] of Object.entries(stages)) {
    it(`tells the ${stage} prompt to treat persona quotes as voice reference only`, () => {
      expect(system).toContain("예시 대사는 말투를 알려 주는 참고")
      expect(system).toContain("대사로 옮겨 쓰지 마라")
    })
  }
})

describe("이야기 상태 원장 계약", () => {
  const system = StoryStateUpdatePrompt.build({
    sceneTitle: "01-opening",
    draftBody: '서하가 말했다. "되돌릴 수 없습니다."'
  }).system

  it("bans verbatim dialogue so the next scene cannot copy it", () => {
    expect(system).toContain("대사를 따옴표로 옮기지 마라")
    expect(system).not.toContain("따옴표로 원문을 그대로 옮겨라")
  })
})
