import { describe, expect, it } from "vitest"

import {
  SceneDialoguePolishPrompt,
  SceneSkeletonPrompt,
  StoryStateUpdatePrompt
} from "@storyboard/story-ai"
import { createEmptyBackground } from "@storyboard/story-model"

const personas = new Map([["서하", '나는 서하다. "추출 뒤에는 되돌릴 수 없습니다."']])
const polishInput = {
  numberedSkeleton: "서하가 말한다. ⟨1⟩“가자.”",
  character: { name: "서하", persona: personas.get("서하") ?? "" },
  otherCharacters: []
}

describe("대사 다듬기 계약", () => {
  const system = SceneDialoguePolishPrompt.build(polishInput).system

  it("forbids inventing turns instead of asking for more of them", () => {
    expect(system).toContain("대사를 새로 만들거나 하나를 둘로 쪼개지")
    expect(system).not.toContain("되묻거나 받아치게")
  })

  it("confines the call to one character's own lines and knowledge", () => {
    expect(system).toContain("[이 인물]이 말한 대사만")
    expect(system).toContain("[아는 것]에 적힌 정보만")
  })

  it("carries the rejection reasons only on a retry", () => {
    const retry = SceneDialoguePolishPrompt.build({
      ...polishInput,
      retryReasons: ["뼈대에 없는 인물이 등장합니다 (지훈)"]
    }).system

    expect(system).not.toContain("반려됐다")
    expect(retry).toContain("반려됐다. 이번에는 어기지 마라: 뼈대에 없는 인물이 등장합니다 (지훈)")
  })
})

describe("페르소나 예시 대사 재사용 금지", () => {
  const background = createEmptyBackground("scene-default", "미정")
  const stages = {
    뼈대: SceneSkeletonPrompt.build({ narrativeSource: "서하가 말한다.", personas, background })
      .system,
    대사다듬기: SceneDialoguePolishPrompt.build(polishInput).system
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
