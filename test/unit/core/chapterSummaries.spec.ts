import { describe, expect, it } from "vitest"

import { buildChapterSummariesMarkdown } from "@/core/chapterSummaries"

describe("buildChapterSummariesMarkdown", () => {
  it("renders each chapter summary with a recap of the previous chapter", () => {
    const markdown = buildChapterSummariesMarkdown("MagicBoy", [
      { chapterTitle: "1장", summary: "엘리아가 학교에 도착한다." },
      { chapterTitle: "2장", summary: "지훈과 갈등이 시작된다." }
    ])

    expect(markdown).toContain("# 장별 요약")
    expect(markdown).toContain("## 1장\n\n엘리아가 학교에 도착한다.")
    expect(markdown).toContain("## 2장\n\n**이전 장 recap:** 엘리아가 학교에 도착한다.\n\n지훈과 갈등이 시작된다.")
  })

  it("omits recap for the first chapter", () => {
    const markdown = buildChapterSummariesMarkdown("MagicBoy", [
      { chapterTitle: "1장", summary: "시작." }
    ])

    expect(markdown).not.toContain("이전 장 recap")
  })

  it("notes when there are no chapters", () => {
    expect(buildChapterSummariesMarkdown("MagicBoy", [])).toContain("요약할 장이 없습니다.")
  })
})
