import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import { mapGrammarIssuesToDiagnostics, toGrammarRange } from "@/presentation/providers/GrammarDiagnosticsProvider"
import type { GrammarIssue } from '@storyboard/story-ai';

function createDocument(text: string): vscode.TextDocument {
  return {
    getText: () => text,
    positionAt: (offset: number) => ({ line: 0, character: offset })
  } as unknown as vscode.TextDocument
}

describe("GrammarDiagnosticsProvider helpers", () => {
  it("returns undefined for out-of-range grammar issues", () => {
    const document = createDocument("문장")
    const invalidIssue: GrammarIssue = {
      start: 0,
      end: 10,
      original: "문장",
      suggestion: "문장",
      reason: "테스트"
    }

    expect(toGrammarRange(document, invalidIssue)).toBeUndefined()
  })

  it("maps valid grammar issues to diagnostics", () => {
    const document = createDocument("이건 정말루 중요해.")
    const issues: GrammarIssue[] = [
      {
        start: 3,
        end: 6,
        original: "정말루",
        suggestion: "정말로",
        reason: "표준어 교정"
      }
    ]

    const diagnostics = mapGrammarIssuesToDiagnostics(document, issues)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.source).toBe("storyboard-grammar")
    expect(diagnostics[0]?.code).toBe("정말로")
    expect(diagnostics[0]?.message).toContain("표준어 교정")
  })
})
