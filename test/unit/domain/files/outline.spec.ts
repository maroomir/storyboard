import { describe, expect, it } from "vitest"

import {
  ChapterPlanParseError,
  parseChapterPlan,
  serializeChapterPlan,
  serializeSynopsisMarkdown
} from "@/domain/files/outline"
import type { ChapterPlan, OutlineSynopsis } from "@/shared/outline"

const plan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "발단",
      summary: "세계와 인물을 소개한다",
      chapters: [
        {
          id: "chapter-1-1",
          title: "1장",
          scenes: [
            {
              id: "scene-1-1-1",
              title: "도착",
              purpose: "주인공 소개",
              characters: ["elia"],
              location: "school",
              emotionalShift: "불안 → 설렘",
              foreshadowing: ["전학 이유"],
              neededCanon: []
            }
          ]
        }
      ]
    }
  ]
}

describe("chapter plan serialization", () => {
  it("round-trips through serialize and parse", () => {
    const parsed = parseChapterPlan(serializeChapterPlan(plan))
    expect(parsed).toEqual(plan)
  })

  it("throws on invalid yaml", () => {
    expect(() => parseChapterPlan(":\n  - [")).toThrow(ChapterPlanParseError)
  })

  it("throws on schema mismatch", () => {
    try {
      parseChapterPlan("version: '1.0.0'\nacts:\n  - title: 막 없이 id가 없음\n")
      throw new Error("expected parse to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ChapterPlanParseError)
      expect((error as ChapterPlanParseError).code).toBe("invalid-chapter-plan-schema")
    }
  })
})

describe("synopsis markdown serialization", () => {
  it("renders headings and values", () => {
    const synopsis: OutlineSynopsis = {
      logline: "소년이 마법을 배운다.",
      genrePromise: "성장 판타지",
      mainConflicts: ["스승과의 갈등", "내면의 두려움"],
      ending: "각성",
      theme: "용기",
      tone: "따뜻함",
      pov: "third-limited",
      styleRules: ["짧은 문장"]
    }

    const markdown = serializeSynopsisMarkdown(synopsis)

    expect(markdown).toContain("# 시놉시스")
    expect(markdown).toContain("## 로그라인\n\n소년이 마법을 배운다.")
    expect(markdown).toContain("- 스승과의 갈등")
    expect(markdown).toContain("## 시점\n\n3인칭 제한적")
  })

  it("marks empty sections as 미작성", () => {
    const synopsis: OutlineSynopsis = {
      logline: "",
      genrePromise: "",
      mainConflicts: [],
      ending: "",
      theme: "",
      tone: "",
      styleRules: []
    }

    expect(serializeSynopsisMarkdown(synopsis)).toContain("## 로그라인\n\n_미작성_")
  })
})
