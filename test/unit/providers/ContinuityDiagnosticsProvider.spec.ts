import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import {
  mapContinuityIssuesToDiagnostics,
  toContinuityRange
} from "@/providers/ContinuityDiagnosticsProvider"
import type { ContinuityIssue } from "@/services/ai/AIService"

function createDocument(text: string): vscode.TextDocument {
  return {
    getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset })
  } as unknown as vscode.TextDocument
}

describe("ContinuityDiagnosticsProvider helpers", () => {
  it("returns undefined for out-of-range continuity issues", () => {
    const document = createDocument("문장")
    const invalidIssue: ContinuityIssue = {
      start: 0,
      end: 10,
      original: "문장",
      reason: "테스트"
    }

    expect(toContinuityRange(document, invalidIssue)).toBeUndefined()
  })

  it("maps valid continuity issues to diagnostics", () => {
    const document = createDocument("파란 눈의 엘리아가 걸어왔다.")
    const issues: ContinuityIssue[] = [
      {
        start: 0,
        end: 5,
        original: "파란 눈",
        reason: "설정상 엘리아의 눈동자 색은 녹색"
      }
    ]

    const diagnostics = mapContinuityIssuesToDiagnostics(document, issues)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.source).toBe("storyboard-continuity")
    expect(diagnostics[0]?.message).toContain("설정상 엘리아의 눈동자 색은 녹색")
  })
})
