import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import {
  computeBodyOffset,
  mapSlopFindingsToDiagnostics,
  toSlopRange
} from "@/presentation/providers/SlopDiagnosticsProvider"
import { analyzeSlop, type SlopFinding } from "@/shared/slop"

function createDocument(text: string): vscode.TextDocument {
  return {
    getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset })
  } as unknown as vscode.TextDocument
}

describe("SlopDiagnosticsProvider helpers", () => {
  it("QAS-C4-12: body-only analysis excludes frontmatter phrases", () => {
    const draft = ["---", "sceneStem: delve", "format: prose", "---", "", "평범한 하루가 지나갔다."].join("\n")
    const body = "평범한 하루가 지나갔다."

    expect(draft).toContain("delve")
    const findings = analyzeSlop(body)
    expect(findings.filter((finding) => finding.kind === "phrase")).toHaveLength(0)
  })

  it("QAS-C4-13: maps a body offset to the absolute document offset", () => {
    const frontmatter = "---\nsceneStem: s01\n---\n"
    const body = "delve into the abyss."
    const documentText = `${frontmatter}${body}`
    const document = createDocument(documentText)

    const bodyOffset = computeBodyOffset(documentText, body)
    expect(bodyOffset).toBe(frontmatter.length)

    const findings = analyzeSlop(body)
    const phraseFinding = findings.find((finding) => finding.kind === "phrase")
    expect(phraseFinding).toBeDefined()

    const range = toSlopRange(document, phraseFinding as SlopFinding, bodyOffset)
    expect(range?.start.character).toBe(bodyOffset + (phraseFinding?.start ?? -1))

    const diagnostics = mapSlopFindingsToDiagnostics(document, [phraseFinding as SlopFinding], bodyOffset)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.range.start.character).toBe(bodyOffset + (phraseFinding?.start ?? -1))
  })

  it("QAS-C4-13b: resolves the body offset to the suffix even when the body recurs earlier", () => {
    const body = "delve here."
    const frontmatter = `---\nsceneStem: delve here.\nformat: prose\n---\n`
    const documentText = `${frontmatter}${body}`

    const bodyOffset = computeBodyOffset(documentText, body)
    expect(bodyOffset).toBe(documentText.length - body.length)
    expect(documentText.slice(bodyOffset)).toBe(body)
  })

  it("QAS-C4-16: maps mixed severities to Warning/Information, never Error", () => {
    const document = createDocument("delve 단순히 집이 아니라 보금자리였다.")
    const findings = analyzeSlop(document.getText())

    const warningFindings = findings.filter((finding) => finding.severity === "warning")
    const infoFindings = findings.filter((finding) => finding.severity === "info")
    expect(warningFindings.length).toBeGreaterThan(0)
    expect(infoFindings.length).toBeGreaterThan(0)

    const diagnostics = mapSlopFindingsToDiagnostics(document, findings, 0)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).not.toBe(vscode.DiagnosticSeverity.Error)
      expect([vscode.DiagnosticSeverity.Warning, vscode.DiagnosticSeverity.Information]).toContain(
        diagnostic.severity
      )
    }
  })

  it("QAS-C4-17: every mapped diagnostic uses the storyboard-slop source", () => {
    const document = createDocument("delve into this.")
    const findings = analyzeSlop(document.getText())

    const diagnostics = mapSlopFindingsToDiagnostics(document, findings, 0)
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.source).toBe("storyboard-slop")
    }
  })

  it("QAS-C4-18: drops findings whose shifted range exceeds document length", () => {
    const document = createDocument("delve")
    const outOfRangeFinding: SlopFinding = {
      start: 0,
      end: 5,
      kind: "phrase",
      message: "상투 표현: \"delve\" — 다른 표현을 검토하세요",
      severity: "warning"
    }

    expect(toSlopRange(document, outOfRangeFinding, 10)).toBeUndefined()
    expect(mapSlopFindingsToDiagnostics(document, [outOfRangeFinding], 10)).toHaveLength(0)
  })

  it("QAS-C4-20: carries the KO '상투 표현:' message through to the diagnostic", () => {
    const document = createDocument("delve")
    const finding: SlopFinding = {
      start: 0,
      end: 5,
      kind: "phrase",
      message: "상투 표현: \"delve\" — 다른 표현을 검토하세요",
      severity: "warning"
    }

    const diagnostics = mapSlopFindingsToDiagnostics(document, [finding], 0)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("상투 표현:")
  })
})
