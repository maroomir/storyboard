import { describe, expect, it } from "vitest"

import { DraftAugmentPrompt, formatAugmentCards } from '@storyboard/story-ai';
import type { DraftAugmentInput } from '@storyboard/story-ai';
import type { BackgroundCard, CharacterCard } from '@storyboard/story-format';

const baseInput: DraftAugmentInput = {
  target: "엘리아가 교실로 들어왔다.",
  scope: "draft",
  format: "novel",
  cards: ["[엘리아] 역할: main\n말투: 짧게 말한다"],
  facts: ["엘리아 — 눈동자 색: 녹색"],
  intent: "주인공 소개"
}

describe("DraftAugmentPrompt", () => {
  it("includes cards, facts, intent and body for draft scope", () => {
    const artifact = DraftAugmentPrompt.build(baseInput, "generic")

    expect(artifact.system).toContain("[본문] 전체를 보충")
    expect(artifact.user).toContain("[카드]")
    expect(artifact.user).toContain("말투: 짧게 말한다")
    expect(artifact.user).toContain("[설정]")
    expect(artifact.user).toContain("- 엘리아 — 눈동자 색: 녹색")
    expect(artifact.user).toContain("[장면 의도]")
    expect(artifact.user).toContain("[본문]")
    expect(artifact.user).toContain("엘리아가 교실로 들어왔다.")
  })

  it("targets only the selection for selection scope", () => {
    const artifact = DraftAugmentPrompt.build({ ...baseInput, scope: "selection" }, "generic")

    expect(artifact.system).toContain("[선택 영역]만 보충")
    expect(artifact.user).toContain("[선택 영역]")
    expect(artifact.user).not.toContain("[본문]")
  })

  it("omits card and fact sections when they are empty", () => {
    const artifact = DraftAugmentPrompt.build({ ...baseInput, cards: [], facts: [] }, "generic")

    expect(artifact.user).not.toContain("[카드]")
    expect(artifact.user).not.toContain("[설정]")
    expect(artifact.user).toContain("[본문]")
  })

  it("adds a prose directive only for the novel format", () => {
    expect(DraftAugmentPrompt.build(baseInput, "generic").system).toContain("따옴표")
    expect(DraftAugmentPrompt.build({ ...baseInput, format: "screenplay" }, "generic").system).not.toContain("따옴표")
  })

  it("keeps the xs system block shorter than generic", () => {
    expect(DraftAugmentPrompt.build(baseInput, "xs").system.length).toBeLessThan(
      DraftAugmentPrompt.build(baseInput, "generic").system.length
    )
  })

  it("uses instruction-first editor role when instruction is provided", () => {
    const artifact = DraftAugmentPrompt.build(
      { ...baseInput, scope: "selection", instruction: "더 긴장감 있게" },
      "generic"
    )

    expect(artifact.system).toContain("편집자")
    expect(artifact.system).toContain("[지시문]")
    expect(artifact.system).not.toContain("보충")
    expect(artifact.user).toContain("[지시문]\n더 긴장감 있게")
    expect(artifact.user).toContain("[선택 영역]")
  })

  it("omits scene intent when instruction is provided", () => {
    const withIntent = DraftAugmentPrompt.build({ ...baseInput, intent: "주인공 소개" }, "generic")
    const withInstruction = DraftAugmentPrompt.build(
      { ...baseInput, intent: "주인공 소개", instruction: "더 짧게" },
      "generic"
    )

    expect(withIntent.user).toContain("[장면 의도]")
    expect(withInstruction.user).not.toContain("[장면 의도]")
  })

  it("uses shorter xs system for instruction mode", () => {
    const artifact = DraftAugmentPrompt.build(
      { ...baseInput, scope: "selection", instruction: "더 짧게" },
      "xs"
    )

    expect(artifact.system).toContain("[지시문]")
    expect(artifact.user).toContain("[지시문]\n더 짧게")
  })
})

describe("formatAugmentCards", () => {
  const character: CharacterCard = {
    type: "character",
    id: "elia",
    name: "엘리아",
    role: "main",
    voice: ["짧게 말한다"],
    description: ["주인공"],
    desire: ["승리"],
    traits: ["용감함", "냉소적"],
    attributes: { age: 17 }
  }

  const background: BackgroundCard = {
    type: "location",
    id: "school-hall",
    name: "학교 복도",
    locationKind: "place",
    description: ["낡은 복도"],
    characterIds: [],
    tags: ["학교"],
    time: "오후",
    weather: "맑음",
    senses: ["분필 냄새"]
  }

  it("formats a character block with its populated fields", () => {
    const [block] = formatAugmentCards([character], undefined)

    expect(block).toContain("[엘리아] 역할: main")
    expect(block).toContain("말투: 짧게 말한다")
    expect(block).toContain("설명: 주인공")
    expect(block).toContain("욕망: 승리")
    expect(block).toContain("특징: 용감함, 냉소적")
    expect(block).toContain("속성: age=17")
  })

  it("omits empty character fields", () => {
    const [block] = formatAugmentCards([{ type: "character", id: "min", name: "민" }], undefined)

    expect(block).toContain("[민] 역할: extra")
    expect(block).not.toContain("말투:")
    expect(block).not.toContain("속성:")
  })

  it("formats a background block and returns one block per card", () => {
    const blocks = formatAugmentCards([character], background)

    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain("[배경: 학교 복도] 오후 맑음")
    expect(blocks[1]).toContain("묘사: 낡은 복도")
    expect(blocks[1]).toContain("감각: 분필 냄새")
  })
})
