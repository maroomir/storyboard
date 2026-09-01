import { describe, expect, it } from "vitest"

import { ChapterPlanPrompt, OutlineSynopsisPrompt } from '@storyboard/story-ai';
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

describe("chapter structure demand", () => {
  it("orders the exact chapter and scene counts when the contract sets them", () => {
    const structured: OutlineBrief = { ...brief, chapterCount: 8, scenesPerChapter: 4 }
    const artifact = ChapterPlanPrompt.build(structured, synopsis, characters)

    expect(artifact.system).toContain("장(chapter)은 정확히 8개")
    expect(artifact.system).toContain("각 장의 씬(scene)은 정확히 4개")
    expect(artifact.user).toContain("8장, 장당 4씬")
  })

  it("says nothing about counts when the contract leaves them out", () => {
    const artifact = ChapterPlanPrompt.build(brief, synopsis, characters)

    expect(artifact.system).not.toContain("정확히")
    expect(artifact.user).not.toContain("구성:")
  })
})

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
