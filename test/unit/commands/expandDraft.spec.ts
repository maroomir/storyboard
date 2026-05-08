import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import { resolveExpandRange } from "@/commands/expandDraft"

describe("expandDraft command helpers", () => {
  it("prefers range argument when it is not empty", () => {
    const editor = {
      selection: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 5 },
        isEmpty: false
      }
    } as unknown as vscode.TextEditor
    const explicitRange = {
      start: { line: 4, character: 1 },
      end: { line: 4, character: 3 },
      isEmpty: false
    } as vscode.Range

    const resolved = resolveExpandRange(editor, explicitRange)

    expect(resolved.start.line).toBe(4)
    expect(resolved.end.character).toBe(3)
  })

  it("falls back to editor selection for empty range argument", () => {
    const editor = {
      selection: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 9 },
        isEmpty: false
      }
    } as unknown as vscode.TextEditor
    const emptyRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      isEmpty: true
    } as vscode.Range

    const resolved = resolveExpandRange(editor, emptyRange)

    expect(resolved.start.line).toBe(1)
    expect(resolved.end.character).toBe(9)
  })
})
