import { describe, expect, it } from "vitest"

import { DraftCritiquePrompt, DraftRevisionPrompt } from '@storyboard/story-ai';

// 접두(캐시되는 공유 재료)와 꼬리(호출마다 다른 것)를 합친 user 전문(#107).
const userText = (artifact: { userPrefix?: string; user: string }): string => [artifact.userPrefix ?? "", artifact.user].join("\n")

describe("DraftCritiquePrompt", () => {
  const input = {
    body: "엘리아가 교실로 들어왔다.",
    intent: "주인공 소개",
    characters: ["엘리아", "지훈"],
    characterCards: ["[엘리아] 역할: main\n말투: 짧은 존댓말"],
    facts: ["엘리아 — 눈동자 색: 녹색"]
  }

  it("includes the draft body, intent, characters and facts", () => {
    const artifact = DraftCritiquePrompt.build(input, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(userText(artifact)).toContain("엘리아가 교실로 들어왔다.")
    expect(userText(artifact)).toContain("주인공 소개")
    expect(userText(artifact)).toContain("지훈")
    expect(userText(artifact)).toContain("[캐릭터 카드]")
    expect(userText(artifact)).toContain("짧은 존댓말")
    expect(userText(artifact)).toContain("눈동자 색")
    expect(artifact.system).toContain("최우선 기준")
  })

  it("includes style constraints and quality criteria when provided", () => {
    const artifact = DraftCritiquePrompt.build(
      { ...input, styleConstraints: ["단문 위주"], qualityCriteria: ["복선 회수"] },
      "generic"
    )

    expect(userText(artifact)).toContain("단문 위주")
    expect(userText(artifact)).toContain("복선 회수")
  })

  it("places the character card after a conflicting voice quality criterion", () => {
    const artifact = DraftCritiquePrompt.build(
      {
        ...input,
        qualityCriteria: ["엘리아: 짧고 건조한 반말/사무체"]
      },
      "generic"
    )

    expect(artifact.system).toContain("[품질 기준]과 충돌하면 캐릭터 카드를")
    expect(userText(artifact).indexOf("[캐릭터 카드]")).toBeGreaterThan(
      userText(artifact).indexOf("[품질 기준]")
    )
    expect(userText(artifact)).toContain("말투: 짧은 존댓말")
  })

  it("includes narration and relation stage from the style directive", () => {
    const artifact = DraftCritiquePrompt.build(
      {
        ...input,
        styleDirective: {
          narration: { person: "first", knowledge: "witnessed", voice: ["건조한 단문"] },
          genre: "허세 코미디",
          relationStage: "적대적 첫 만남"
        }
      },
      "generic"
    )

    expect(userText(artifact)).toContain("[시점]")
    expect(userText(artifact)).toContain("1인칭 · 목격 범위")
    expect(userText(artifact)).toContain("[서술자 목소리]")
    expect(userText(artifact)).toContain("건조한 단문")
    expect(userText(artifact)).toContain("[관계 단계]")
    expect(userText(artifact)).toContain("적대적 첫 만남")
    expect(artifact.system).toContain("관계 단계")
  })

  it("keeps the xs system block shorter than generic", () => {
    expect(DraftCritiquePrompt.build(input, "xs").system.length).toBeLessThan(
      DraftCritiquePrompt.build(input, "generic").system.length
    )
  })
})

describe("DraftRevisionPrompt", () => {
  const input = {
    body: "엘리아가 교실로 들어왔다.",
    format: "novel" as const,
    instructions: ["설정 모순: 눈동자 색을 녹색으로", "반복 줄이기"],
    intent: "주인공 소개",
    facts: ["엘리아 — 눈동자 색: 녹색"],
    characterCards: ["[엘리아] 역할: main\n말투: 짧은 존댓말"]
  }

  it("lists the revision instructions and keeps the body", () => {
    const artifact = DraftRevisionPrompt.build(input, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(userText(artifact)).toContain("- 설정 모순: 눈동자 색을 녹색으로")
    expect(userText(artifact)).toContain("- 반복 줄이기")
    expect(userText(artifact)).toContain("[캐릭터 카드]")
    expect(userText(artifact)).toContain("짧은 존댓말")
    expect(userText(artifact)).toContain("엘리아가 교실로 들어왔다.")
    expect(artifact.system).toContain("최우선 불변 조건")
  })

  it("keeps the xs system block shorter than generic", () => {
    expect(DraftRevisionPrompt.build(input, "xs").system.length).toBeLessThan(
      DraftRevisionPrompt.build(input, "generic").system.length
    )
  })
})
