import { describe, expect, it } from "vitest"

import { ChapterPlanPrompt } from "@storyboard/story-ai"
import type { OutlineBrief, OutlineCharacterBrief, OutlineSynopsis } from "@storyboard/story-model"

describe("ChapterPlanPrompt golden", () => {
  const brief: OutlineBrief = {
    projectName: "항구의 밤",
    format: "novel",
    language: "ko",
    genre: "미스터리",
    audience: "성인",
    pov: "third-limited",
    targetWordCount: 80000,
    concept: "사라진 배",
    description: "항구 도시의 실종 사건",
    tags: ["항구", "실종"],
    prohibitions: ["과도한 폭력"],
    styleConstraints: ["단문 위주"],
    qualityCriteria: ["복선 회수"],
    threads: [],
    narratorIds: []
  }
  const bareBrief: OutlineBrief = {
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
  const synopsis: OutlineSynopsis = {
    logline: "의사가 실종된 배를 쫓는다.",
    genrePromise: "추리",
    mainConflicts: ["선주와의 대립", "과거의 죄"],
    ending: "배가 돌아온다",
    theme: "속죄",
    tone: "음울함",
    styleRules: []
  }
  const emptySynopsis: OutlineSynopsis = {
    logline: "",
    genrePromise: "",
    mainConflicts: [],
    ending: "",
    theme: "",
    tone: "",
    styleRules: []
  }
  const characters: readonly OutlineCharacterBrief[] = [
    { id: "elia", name: "엘리아", role: "main" },
    { id: "jun", name: "준" },
    { id: "ha", name: "하", role: "" }
  ]
  const threads = [
    { id: "main", title: "본편" },
    { id: "past", title: "과거" }
  ]

  it.each(["generic", "xs", "rich"] as const)("renders a linear plan for the %s variant", (variant) => {
    expect(ChapterPlanPrompt.build(brief, synopsis, characters, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders empty material for the %s variant", (variant) => {
    expect(ChapterPlanPrompt.build(bareBrief, emptySynopsis, [], variant)).toMatchSnapshot()
  })

  it("renders each synopsis field on its own", () => {
    expect(ChapterPlanPrompt.build(bareBrief, { ...emptySynopsis, logline: "로그라인만" }, characters)).toMatchSnapshot()
    expect(ChapterPlanPrompt.build(bareBrief, { ...emptySynopsis, mainConflicts: [""] }, characters)).toMatchSnapshot()
    expect(ChapterPlanPrompt.build(bareBrief, { ...emptySynopsis, ending: "결말만" }, characters)).toMatchSnapshot()
    expect(ChapterPlanPrompt.build(bareBrief, { ...emptySynopsis, theme: "주제만" }, characters)).toMatchSnapshot()
  })

  it.each([
    ["both counts", { chapterCount: 8, scenesPerChapter: 4 }],
    ["the chapter count", { chapterCount: 12 }],
    ["the scene count", { scenesPerChapter: 3 }],
    ["a zero chapter count", { chapterCount: 0 }]
  ] as const)("demands %s", (_label, counts) => {
    expect(ChapterPlanPrompt.build({ ...brief, ...counts }, synopsis, characters)).toMatchSnapshot()
  })

  it.each([
    ["omnibus with threads", { composition: "omnibus", threads, narratorIds: [] }],
    ["omnibus with narrators only", { composition: "omnibus", threads: [], narratorIds: ["hana"] }],
    ["alternating-pov with narrators", { composition: "alternating-pov", threads: [], narratorIds: ["hana", "jun"] }],
    ["alternating-pov without narrators", { composition: "alternating-pov", threads, narratorIds: [] }],
    ["frame with threads", { composition: "frame", threads, narratorIds: ["hana"] }],
    ["frame without threads or narrators", { composition: "frame", threads: [], narratorIds: [] }],
    ["linear with threads", { composition: "linear", threads, narratorIds: ["hana"] }]
  ] as const)("renders %s", (_label, composition) => {
    expect(
      ChapterPlanPrompt.build({ ...brief, ...composition, chapterCount: 6 }, synopsis, characters)
    ).toMatchSnapshot()
  })
})
