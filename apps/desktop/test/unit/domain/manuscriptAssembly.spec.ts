import { describe, expect, it } from "vitest"

import { assembleManuscript, type ManuscriptDraftEntry } from '@seedkernel/wasm'
import type { ChapterPlan } from '@seedkernel/wasm';

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
            { id: "arrival", title: "도착", purpose: "", characters: [], foreshadowing: [] },
            { id: "meeting", title: "만남", purpose: "", characters: [], foreshadowing: [] }
          ]
        },
        {
          id: "chapter-1-2",
          title: "2장",
          scenes: [{ id: "class", title: "수업", purpose: "", characters: [], foreshadowing: [] }]
        }
      ]
    },
    {
      id: "act-2",
      title: "전개",
      chapters: [
        {
          id: "chapter-2-1",
          title: "3장",
          scenes: [{ id: "rumor", title: "소문", purpose: "", characters: [], foreshadowing: [] }]
        }
      ]
    }
  ]
}

function drafts(entries: [number, ManuscriptDraftEntry][]): Map<number, ManuscriptDraftEntry> {
  return new Map(entries)
}

describe("assembleManuscript", () => {
  it("creates one file per chapter ordered by the plan", () => {
    const result = assembleManuscript({
      plan,
      projectName: "MagicBoy",
      draftsByOrder: drafts([
        [1, { stem: "01-arrival", body: "도착 본문" }],
        [2, { stem: "02-meeting", body: "만남 본문" }],
        [3, { stem: "03-class", body: "수업 본문" }],
        [4, { stem: "04-rumor", body: "소문 본문" }]
      ])
    })

    expect(result.chapters.map((chapter) => chapter.fileName)).toEqual([
      "01-1.md",
      "02-2.md",
      "03-3.md"
    ])
    expect(result.includedCount).toBe(4)
    expect(result.missingCount).toBe(0)
    expect(result.extraCount).toBe(0)

    const firstChapter = result.chapters[0]
    expect(firstChapter.markdown).toContain("# 1장")
    expect(firstChapter.markdown).toContain("*발단*")
    expect(firstChapter.markdown).toContain("## 도착")
    expect(firstChapter.markdown).toContain("도착 본문")
    expect(firstChapter.markdown).toContain("## 만남")
  })

  it("builds a volume with act/chapter/scene heading levels and all bodies", () => {
    const result = assembleManuscript({
      plan,
      projectName: "MagicBoy",
      draftsByOrder: drafts([
        [1, { stem: "01-arrival", body: "도착 본문" }],
        [2, { stem: "02-meeting", body: "만남 본문" }],
        [3, { stem: "03-class", body: "수업 본문" }],
        [4, { stem: "04-rumor", body: "소문 본문" }]
      ])
    })

    expect(result.volumeMarkdown).toContain("# MagicBoy")
    expect(result.volumeMarkdown).toContain("## 발단")
    expect(result.volumeMarkdown).toContain("## 전개")
    expect(result.volumeMarkdown).toContain("### 1장")
    expect(result.volumeMarkdown).toContain("#### 도착")
    expect(result.volumeMarkdown).toContain("소문 본문")
  })

  it("marks planned scenes without a draft as missing", () => {
    const result = assembleManuscript({
      plan,
      projectName: "MagicBoy",
      draftsByOrder: drafts([
        [1, { stem: "01-arrival", body: "도착 본문" }],
        [3, { stem: "03-class", body: "수업 본문" }]
      ])
    })

    expect(result.includedCount).toBe(2)
    expect(result.missingCount).toBe(2)
    expect(result.chapters[0].markdown).toContain("> (초안 없음: 만남)")
  })

  it("preserves drafts beyond the plan in an extras chapter", () => {
    const result = assembleManuscript({
      plan,
      projectName: "MagicBoy",
      draftsByOrder: drafts([
        [1, { stem: "01-arrival", body: "도착 본문" }],
        [2, { stem: "02-meeting", body: "만남 본문" }],
        [3, { stem: "03-class", body: "수업 본문" }],
        [4, { stem: "04-rumor", body: "소문 본문" }],
        [5, { stem: "05-bonus", body: "보너스 본문" }]
      ])
    })

    expect(result.extraCount).toBe(1)
    const extrasChapter = result.chapters.at(-1)
    expect(extrasChapter?.fileName).toBe("04-extras.md")
    expect(extrasChapter?.markdown).toContain("# 기타 (계획 외)")
    expect(extrasChapter?.markdown).toContain("보너스 본문")
  })
})
