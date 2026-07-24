import { describe, expect, it } from "vitest"

import {
  buildForeshadowingMarkdown,
  collectForeshadowing,
  countForeshadowing
} from "@/domain/foreshadowingTracker"
import type { ChapterPlan } from '@storyboard/story-format';

const plan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "발단",
      chapters: [
        {
          id: "chapter-1-1",
          title: "1장",
          scenes: [
            {
              id: "arrival",
              title: "도착",
              purpose: "",
              characters: [],
              foreshadowing: ["전학 이유", "낡은 반지"]
            },
            { id: "class", title: "수업", purpose: "", characters: [], foreshadowing: [] }
          ]
        },
        {
          id: "chapter-1-2",
          title: "2장",
          scenes: [
            { id: "rumor", title: "소문", purpose: "", characters: [], foreshadowing: ["사라진 학생"] }
          ]
        }
      ]
    }
  ]
}

describe("collectForeshadowing", () => {
  it("groups foreshadowing items by chapter and skips scenes without any", () => {
    const chapters = collectForeshadowing(plan)

    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.chapterTitle).toBe("1장")
    expect(chapters[0]?.entries.map((entry) => entry.item)).toEqual(["전학 이유", "낡은 반지"])
    expect(chapters[0]?.entries[0]?.sceneTitle).toBe("도착")
    expect(chapters[1]?.entries.map((entry) => entry.item)).toEqual(["사라진 학생"])
    expect(countForeshadowing(chapters)).toBe(3)
  })
})

describe("buildForeshadowingMarkdown", () => {
  it("renders a checklist grouped by chapter", () => {
    const markdown = buildForeshadowingMarkdown("MagicBoy", collectForeshadowing(plan))

    expect(markdown).toContain("# 복선 추적 (회수 대상)")
    expect(markdown).toContain("## 1장")
    expect(markdown).toContain("- [ ] 전학 이유 — 도착")
    expect(markdown).toContain("## 2장")
    expect(markdown).toContain("- [ ] 사라진 학생 — 소문")
  })

  it("notes when there is no foreshadowing", () => {
    const empty: ChapterPlan = { version: "1.0.0", acts: [] }
    expect(buildForeshadowingMarkdown("MagicBoy", collectForeshadowing(empty))).toContain(
      "등록된 복선이 없습니다."
    )
  })
})
