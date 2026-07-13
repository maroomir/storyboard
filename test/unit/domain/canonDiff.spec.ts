import { describe, expect, it } from "vitest"

import { buildCanonDiffMarkdown, diffCandidatesAgainstCanon } from "@/domain/canonDiff"
import type { BibleCandidateRecord } from "@/domain/files/bibleCandidates"
import type { BibleFact, StoryBible } from "@/shared/bible"

const fact = (id: string, key: string, value: string, status: BibleFact["status"]): BibleFact => ({
  id: `character:${id}:${key}`,
  subject: { kind: "character", id },
  key,
  value,
  status
})

const candidates = (facts: BibleFact[]): BibleCandidateRecord => ({
  sceneStem: "01-prologue",
  generatedAt: "2026-06-20T00:00:00.000Z",
  facts
})

describe("diffCandidatesAgainstCanon", () => {
  it("returns only candidates not already promoted to canon", () => {
    const canon: StoryBible = {
      version: "1.0.0",
      facts: [fact("elia", "눈동자 색", "녹색", "canon")]
    }
    const records = [
      candidates([
        fact("elia", "눈동자 색", "녹색", "candidate"),
        fact("elia", "키", "160cm", "candidate")
      ])
    ]

    const { pending } = diffCandidatesAgainstCanon(canon, records)
    expect(pending.map((item) => item.key)).toEqual(["키"])
  })

  it("dedupes the same subject+key across scenes", () => {
    const records = [
      candidates([fact("elia", "키", "160cm", "candidate")]),
      { ...candidates([fact("elia", "키", "161cm", "candidate")]), sceneStem: "02-chapter" }
    ]

    const { pending } = diffCandidatesAgainstCanon({ version: "1.0.0", facts: [] }, records)
    expect(pending).toHaveLength(1)
  })
})

describe("buildCanonDiffMarkdown", () => {
  it("lists pending facts", () => {
    const markdown = buildCanonDiffMarkdown("MagicBoy", [fact("elia", "키", "160cm", "candidate")])
    expect(markdown).toContain("# Canon Diff")
    expect(markdown).toContain("- [character:elia] 키: 160cm")
  })

  it("notes when nothing is pending", () => {
    expect(buildCanonDiffMarkdown("MagicBoy", [])).toContain("미승격 설정 후보가 없습니다.")
  })

  it("does not render a timeline for the 2-arg form", () => {
    expect(buildCanonDiffMarkdown("MagicBoy", [])).not.toContain("설정 변경 타임라인")
  })

  it("renders an ordered timeline for a multi-version canon fact", () => {
    const canon: StoryBible = {
      version: "1.0.0",
      facts: [
        { id: "arm-a", subject: { kind: "character", id: "elia" }, key: "팔", value: "멀쩡함", status: "canon", validUntil: "03-x" },
        { id: "arm-b", subject: { kind: "character", id: "elia" }, key: "팔", value: "의수", status: "canon", validFrom: "04-x" }
      ]
    }

    const markdown = buildCanonDiffMarkdown("MagicBoy", [], canon)

    expect(markdown).toContain("## 설정 변경 타임라인")
    expect(markdown).toContain("### [character:elia] 팔")
    expect(markdown).toContain("- `…–03`: 멀쩡함")
    expect(markdown).toContain("- `04–`: 의수")
    expect(markdown.indexOf("멀쩡함")).toBeLessThan(markdown.indexOf("의수"))
  })

  it("omits the timeline when canon has only single-version facts", () => {
    const canon: StoryBible = {
      version: "1.0.0",
      facts: [
        { id: "arm", subject: { kind: "character", id: "elia" }, key: "팔", value: "의수", status: "canon" }
      ]
    }

    expect(buildCanonDiffMarkdown("MagicBoy", [], canon)).not.toContain("설정 변경 타임라인")
  })

  it("orders two open-start versions stably without NaN sort hazard", () => {
    const canon: StoryBible = {
      version: "1.0.0",
      facts: [
        { id: "mood-a", subject: { kind: "character", id: "elia" }, key: "기분", value: "불안", status: "canon", validUntil: "03-x" },
        { id: "mood-b", subject: { kind: "character", id: "elia" }, key: "기분", value: "평온", status: "canon", validUntil: "10-x" }
      ]
    }

    const markdown = buildCanonDiffMarkdown("MagicBoy", [], canon)

    expect(markdown).toContain("- `…–03`: 불안")
    expect(markdown).toContain("- `…–10`: 평온")
    expect(markdown.indexOf("불안")).toBeLessThan(markdown.indexOf("평온"))
  })
})
