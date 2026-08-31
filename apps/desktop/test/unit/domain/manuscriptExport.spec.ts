import { describe, expect, it } from "vitest"

import { renderManuscriptExport, toPlainText } from "@storyboard/story-engine"

describe("toPlainText", () => {
  it("strips heading markers, blockquotes, bold, and inline code", () => {
    const markdown = ["# 제목", "", "> 인용", "**굵게** 그리고 `코드`", "- 항목"].join("\n")
    expect(toPlainText(markdown)).toBe(["제목", "", "인용", "굵게 그리고 코드", "- 항목"].join("\n"))
  })

  it("strips single-asterisk emphasis such as act titles", () => {
    const markdown = ["# 1장", "", "*발단*", "본문 *강조* 끝"].join("\n")
    expect(toPlainText(markdown)).toBe(["1장", "", "발단", "본문 강조 끝"].join("\n"))
  })
})

describe("renderManuscriptExport", () => {
  it("keeps markdown as-is for md and converts to plain text for txt", () => {
    const markdown = "# 제목\n\n본문"
    expect(renderManuscriptExport(markdown, "md")).toBe(markdown)
    expect(renderManuscriptExport(markdown, "txt")).toBe("제목\n\n본문")
  })
})
