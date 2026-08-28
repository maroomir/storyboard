import { describe, expect, it } from "vitest"

import {
  craftContractLines,
  PersonaDialoguePrompt,
  SceneGroundingPrompt,
  sceneGroundingLines
} from '@storyboard/story-ai';
import type { Background } from '@storyboard/story-format';

const background: Background = {
  type: "location",
  id: "rooftop",
  name: "옥탑방 현관",
  locationKind: "place",
  description: [],
  characterIds: [],
  tags: []
}

describe("SceneGroundingPrompt", () => {
  it("asks only for the missing fields and passes confirmed facts as context", () => {
    const artifact = SceneGroundingPrompt.build({
      sceneBody: "세상 사람들 모두 정답을 알긴 할까",
      missingFields: ["incident", "time"],
      characterNames: ["윤서하", "한도윤"],
      knownGrounding: ["- 장소: 옥탑방 현관"]
    })

    expect(artifact.system).toContain("incident (사건)")
    expect(artifact.system).toContain("time (시점)")
    expect(artifact.system).not.toContain("place (장소)")
    expect(artifact.user).toContain("윤서하, 한도윤")
    expect(artifact.user).toContain("- 장소: 옥탑방 현관")
    expect(artifact.user).toContain("세상 사람들 모두 정답을 알긴 할까")
  })
})

describe("scene grounding prompt lines", () => {
  it("renders only the fields that are set", () => {
    expect(sceneGroundingLines(undefined)).toEqual([])
    expect(sceneGroundingLines({ incident: "면접 탈락", time: "11월 말" })).toEqual([
      "[이 장면의 확정 사실]",
      "- 사건: 면접 탈락",
      "- 시점: 11월 말"
    ])
  })

  it("puts confirmed facts into the dialogue prompt", () => {
    const artifact = PersonaDialoguePrompt.build(
      "서하가 문 앞에 선다",
      new Map([["윤서하", "지친 사람"]]),
      background,
      undefined,
      "generic",
      undefined,
      { incident: "임용시험 면접에서 떨어졌다" }
    )

    expect(artifact.user).toContain("[이 장면의 확정 사실]")
    expect(artifact.user).toContain("- 사건: 임용시험 면접에서 떨어졌다")
  })
})

describe("craft contract lines", () => {
  it("applies built-in defaults when the project overrides nothing", () => {
    const lines = craftContractLines(undefined)

    expect(lines.some((line) => line.includes("다시 설명하지 마라"))).toBe(true)
    expect(lines.some((line) => line.includes("3회를 넘겨 반복하지 마라"))).toBe(true)
    // 후렴·반복 대사도 같은 상한에 걸려야 한다.
    expect(lines.some((line) => line.includes("대사·후렴구"))).toBe(true)
    expect(lines.some((line) => line.includes("어깨가 떨렸다"))).toBe(true)
    expect(lines.some((line) => line.includes("자기 목적이나 결점"))).toBe(true)
  })

  it("honours per-project overrides", () => {
    const lines = craftContractLines({
      banTelling: false,
      motifRepeatLimit: 5,
      stockGestureBlacklist: [],
      requireCharacterInterior: false,
      actionClarity: false,
      modulateDensity: false,
      sceneLengthMultiplier: 0
    })

    expect(lines).toEqual([
      "같은 심상·소재(예: 흐릿한 길, 문틈)는 물론 같은 대사·후렴구·문장도 장면 전체에서 5회를 넘겨 반복하지 마라."
    ])
  })

  it("renders the action-clarity and density-modulation rules by default", () => {
    const lines = craftContractLines(undefined)

    expect(lines.some((line) => line.includes("한 동작과 그 결과를 붙여 쓰고"))).toBe(true)
    expect(lines.some((line) => line.includes("건조한 중계로 만들지 마라"))).toBe(true)
    expect(lines.some((line) => line.includes("밀도를 일정하게 유지하지 마라"))).toBe(true)
  })

  it("drops each new rule independently when a project turns it off", () => {
    const withoutAction = craftContractLines({ actionClarity: false })
    expect(withoutAction.some((line) => line.includes("건조한 중계로 만들지 마라"))).toBe(false)
    expect(withoutAction.some((line) => line.includes("밀도를 일정하게 유지하지 마라"))).toBe(true)

    const withoutDensity = craftContractLines({ modulateDensity: false })
    expect(withoutDensity.some((line) => line.includes("건조한 중계로 만들지 마라"))).toBe(true)
    expect(withoutDensity.some((line) => line.includes("밀도를 일정하게 유지하지 마라"))).toBe(false)
  })

  it("reaches the generation prompt even without a style directive", () => {
    const artifact = PersonaDialoguePrompt.build(
      "서하가 문 앞에 선다",
      new Map(),
      background,
      undefined,
      "generic"
    )

    expect(artifact.system).toContain("다시 설명하지 마라")
  })
})
