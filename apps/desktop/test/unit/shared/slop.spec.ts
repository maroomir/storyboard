import { describe, expect, it } from "vitest"

import { analyzeSlop, slopPhrases, type SlopFinding } from "@weeding/wasm"

function findingsByKind(findings: SlopFinding[], kind: SlopFinding["kind"]): SlopFinding[] {
  return findings.filter((finding) => finding.kind === kind)
}

describe("analyzeSlop", () => {
  it("QAS-C4-01: flags EN 'delve' once", () => {
    const body = "delve"
    const phraseFindings = findingsByKind(analyzeSlop(body), "phrase")

    expect(phraseFindings).toHaveLength(1)
    const finding = phraseFindings[0]
    expect(body.slice(finding?.start, finding?.end)).toBe("delve")
  })

  it("QAS-C4-02: flags KO '어쩌면' once", () => {
    const body = "어쩌면 그는 떠났다."
    const phraseFindings = findingsByKind(analyzeSlop(body), "phrase")

    expect(phraseFindings).toHaveLength(1)
    const finding = phraseFindings[0]
    expect(body.slice(finding?.start, finding?.end)).toBe("어쩌면")
  })

  it("QAS-C4-03: clean body yields no phrase findings", () => {
    const findings = analyzeSlop("평범한 하루가 지나갔다.")

    expect(findingsByKind(findings, "phrase")).toHaveLength(0)
  })

  it("QAS-C4-04: flags EN 'not just ... but ...' contrast once", () => {
    const findings = analyzeSlop("It was not just a house but a home.")

    expect(findingsByKind(findings, "contrast")).toHaveLength(1)
  })

  it("QAS-C4-05: flags KO '단순히 ... 가 아니라 ...' contrast once", () => {
    const findings = analyzeSlop("단순히 집이 아니라 보금자리였다.")

    expect(findingsByKind(findings, "contrast")).toHaveLength(1)
  })

  it("QAS-C4-06: does not flag contrast without the cue", () => {
    const findings = analyzeSlop("작지만 따뜻했다.")

    expect(findingsByKind(findings, "contrast")).toHaveLength(0)
  })

  it("QAS-C4-07: flags a trigram repeated 3x once per occurrence with the count", () => {
    const findings = analyzeSlop("the old man walked. the old man sat. the old man slept.")
    const trigramFindings = findingsByKind(findings, "trigram")

    expect(trigramFindings).toHaveLength(3)
    for (const finding of trigramFindings) {
      expect(finding.message).toContain("3회")
    }
  })

  it("QAS-C4-08: does not flag a trigram repeated exactly 2x", () => {
    const findings = analyzeSlop("the old man walked. the old man sat.")

    expect(findingsByKind(findings, "trigram")).toHaveLength(0)
  })

  it("QAS-C4-09: flags a trigram repeated exactly 3x at the threshold", () => {
    const findings = analyzeSlop("the old man walked. the old man sat. the old man slept.")
    const trigramFindings = findingsByKind(findings, "trigram")

    expect(trigramFindings).toHaveLength(3)
  })

  it("QAS-C4-10: matches EN phrase case-insensitively", () => {
    const findings = analyzeSlop("Delve into this and DELVE deeper.")

    expect(findingsByKind(findings, "phrase")).toHaveLength(2)
  })

  it("QAS-C4-11: matches KO phrase literally as exact substring, not a near-miss", () => {
    const koPhrase = slopPhrases().ko[0] ?? ""
    expect(koPhrase.length).toBeGreaterThan(0)

    const exactHit = analyzeSlop(`${koPhrase} 그는 멈췄다.`)
    expect(findingsByKind(exactHit, "phrase")).toHaveLength(1)

    const nearMiss = analyzeSlop(`${koPhrase.slice(0, koPhrase.length - 1)} 그는 멈췄다.`)
    expect(findingsByKind(nearMiss, "phrase")).toHaveLength(0)
  })

  it("QAS-C4-14: returns [] for an empty body", () => {
    expect(analyzeSlop("")).toEqual([])
  })

  it("QAS-C4-15: returns no trigram finding for a short body without throwing", () => {
    const findings = analyzeSlop("짧다")

    expect(findingsByKind(findings, "trigram")).toHaveLength(0)
  })

  it("QAS-C4-09b: counts overlapping single-token repeats as non-overlapping occurrences", () => {
    const nine = analyzeSlop("네 네 네 네 네 네 네 네 네")
    const nineTrigrams = findingsByKind(nine, "trigram")

    expect(nineTrigrams).toHaveLength(3)
    for (const finding of nineTrigrams) {
      expect(finding.message).toContain("3회")
    }

    const six = analyzeSlop("네 네 네 네 네 네")
    expect(findingsByKind(six, "trigram")).toHaveLength(0)
  })

  it("QAS-C4-20: KO D1 message starts with the '상투 표현:' prefix", () => {
    const phraseFindings = findingsByKind(analyzeSlop("어쩌면 그는 떠났다."), "phrase")

    expect(phraseFindings).toHaveLength(1)
    expect(phraseFindings[0]?.message.startsWith("상투 표현:")).toBe(true)
  })
})
