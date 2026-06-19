import { describe, expect, it } from "vitest"

import { DraftCritiquePrompt } from "@/services/ai/prompts/draftCritique"
import { DraftRevisionPrompt } from "@/services/ai/prompts/draftRevision"

describe("DraftCritiquePrompt", () => {
  const input = {
    body: "엘리아가 교실로 들어왔다.",
    intent: "주인공 소개",
    characters: ["엘리아", "지훈"],
    facts: ["엘리아 — 눈동자 색: 녹색"]
  }

  it("includes the draft body, intent, characters and facts", () => {
    const artifact = DraftCritiquePrompt.build(input, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(artifact.user).toContain("엘리아가 교실로 들어왔다.")
    expect(artifact.user).toContain("주인공 소개")
    expect(artifact.user).toContain("지훈")
    expect(artifact.user).toContain("눈동자 색")
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
    facts: ["엘리아 — 눈동자 색: 녹색"]
  }

  it("lists the revision instructions and keeps the body", () => {
    const artifact = DraftRevisionPrompt.build(input, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(artifact.user).toContain("- 설정 모순: 눈동자 색을 녹색으로")
    expect(artifact.user).toContain("- 반복 줄이기")
    expect(artifact.user).toContain("엘리아가 교실로 들어왔다.")
  })

  it("keeps the xs system block shorter than generic", () => {
    expect(DraftRevisionPrompt.build(input, "xs").system.length).toBeLessThan(
      DraftRevisionPrompt.build(input, "generic").system.length
    )
  })
})
