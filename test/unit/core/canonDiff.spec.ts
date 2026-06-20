import { describe, expect, it } from "vitest"

import { buildCanonDiffMarkdown, diffCandidatesAgainstCanon } from "@/core/canonDiff"
import type { BibleCandidateRecord } from "@/files/bibleCandidates"
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
})
