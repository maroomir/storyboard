import { describe, expect, it } from "vitest"

import { ChapterPlanPrompt } from "@/infrastructure/ai/prompts/chapterPlan"
import { OutlineSynopsisPrompt } from "@/infrastructure/ai/prompts/outlineSynopsis"
import type { OutlineBrief, OutlineCharacterBrief, OutlineSynopsis } from '@storyboard/story-format';

const brief: OutlineBrief = {
  projectName: "MagicBoy",
  format: "novel",
  language: "ko",
  genre: "판타지",
  audience: "청소년",
  pov: "third-limited",
  targetWordCount: 80_000,
  tags: ["학원"],
  prohibitions: ["과도한 폭력"],
  styleConstraints: ["단문 위주"],
  qualityCriteria: ["복선 회수"]
}

const synopsis: OutlineSynopsis = {
  logline: "소년이 마법을 배운다.",
  genrePromise: "성장 판타지",
  mainConflicts: ["스승과의 갈등"],
  ending: "각성",
  theme: "용기",
  tone: "따뜻함",
  pov: "third-limited",
  styleRules: ["짧은 문장"]
}

const characters: readonly OutlineCharacterBrief[] = [
  { id: "elia", name: "엘리아", role: "main" },
  { id: "jihoon", name: "지훈" }
]

describe("OutlineSynopsisPrompt", () => {
  it("includes contract fields in the user block", () => {
    const artifact = OutlineSynopsisPrompt.build(brief, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(artifact.user).toContain("판타지")
    expect(artifact.user).toContain("청소년")
    expect(artifact.user).toContain("3인칭 제한적")
    expect(artifact.user).toContain("단문 위주")
    expect(artifact.user).toContain("복선 회수")
  })

  it("keeps the xs system block shorter than generic", () => {
    const generic = OutlineSynopsisPrompt.build(brief, "generic")
    const xs = OutlineSynopsisPrompt.build(brief, "xs")
    expect(xs.system.length).toBeLessThan(generic.system.length)
  })
})

describe("ChapterPlanPrompt", () => {
  it("lists character ids for scene references", () => {
    const artifact = ChapterPlanPrompt.build(brief, synopsis, characters, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(artifact.user).toContain("elia")
    expect(artifact.user).toContain("jihoon")
    expect(artifact.user).toContain("소년이 마법을 배운다.")
  })

  it("keeps the xs system block shorter than generic", () => {
    const generic = ChapterPlanPrompt.build(brief, synopsis, characters, "generic")
    const xs = ChapterPlanPrompt.build(brief, synopsis, characters, "xs")
    expect(xs.system.length).toBeLessThan(generic.system.length)
  })
})
