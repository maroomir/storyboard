import { describe, expect, it } from "vitest"

import type { OutlineBrief } from "@storyboard/story-format"
import { OutlineSynopsisPrompt } from "@storyboard/story-ai"

describe("OutlineSynopsisPrompt golden", () => {
  const full: OutlineBrief = {
    projectName: "항구의 밤",
    format: "novel",
    language: "ko",
    genre: "미스터리",
    audience: "성인",
    pov: "third-limited",
    targetWordCount: 120000,
    chapterCount: 12,
    scenesPerChapter: 4,
    concept: "사라진 등대지기",
    description: "항구 도시의 연쇄 실종",
    tags: ["항구", "실종"],
    prohibitions: ["초자연 해결 금지"],
    styleConstraints: ["건조체", "짧은 문장"],
    qualityCriteria: ["복선 회수"],
    threads: [],
    narratorIds: []
  }
  const bare: OutlineBrief = {
    projectName: "무제",
    format: "screenplay",
    language: "ko",
    tags: [],
    prohibitions: [],
    styleConstraints: [],
    qualityCriteria: [],
    threads: [],
    narratorIds: []
  }

  it.each(["generic", "xs", "rich"] as const)("renders every field for the %s variant", (variant) => {
    expect(OutlineSynopsisPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves missing fields out for the %s variant", (variant) => {
    expect(OutlineSynopsisPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("renders partial composition and blank fields", () => {
    expect(OutlineSynopsisPrompt.build({ ...bare, chapterCount: 8 })).toMatchSnapshot()
    expect(OutlineSynopsisPrompt.build({ ...bare, scenesPerChapter: 3, pov: "first" })).toMatchSnapshot()
    expect(
      OutlineSynopsisPrompt.build({ ...bare, genre: "   ", concept: "", targetWordCount: 0, tags: [""] })
    ).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(OutlineSynopsisPrompt.build(full)).toMatchSnapshot()
  })
})
