import { describe, expect, it } from "vitest"

import { createDraft, DraftParseError, parseDraft, serializeDraft } from '@seedkernel/wasm';

describe("draft file codec", () => {
  it("serializes and parses a draft with stable frontmatter", () => {
    const draft = createDraft({
      sceneStem: "01-prologue",
      format: "novel",
      generatedAt: "2026-05-03T14:00:00.000Z",
      body: "샘플 원고입니다.\n"
    })

    const serializedDraft = serializeDraft(draft)

    expect(serializedDraft).toBe(
      [
        "---",
        "sceneStem: 01-prologue",
        "format: novel",
        "generatedAt: '2026-05-03T14:00:00.000Z'",
        "---",
        "샘플 원고입니다.",
        ""
      ].join("\n")
    )
    expect(parseDraft(serializedDraft)).toEqual(draft)
  })

  it("rejects drafts without frontmatter", () => {
    expect(() => parseDraft("샘플 원고입니다.")).toThrow(DraftParseError)
  })
})