import { describe, expect, it } from "vitest"

import {
  createDraft,
  DraftParseError,
  extractDraftBody,
  parseDraft,
  serializeDraft
} from '@storyboard/story-model';

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

  it("round-trips provenance keys when present", () => {
    const draft = createDraft({
      sceneStem: "01-prologue",
      format: "novel",
      generatedAt: "2026-05-03T14:00:00.000Z",
      generator: "storyboard@0.6.1",
      providerId: "claude-code",
      model: "claude-sonnet-5",
      body: "샘플 원고입니다.\n"
    })

    const serializedDraft = serializeDraft(draft)

    expect(serializedDraft).toBe(
      [
        "---",
        "sceneStem: 01-prologue",
        "format: novel",
        "generatedAt: '2026-05-03T14:00:00.000Z'",
        "generator: storyboard@0.6.1",
        "providerId: claude-code",
        "model: claude-sonnet-5",
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

  it("extracts the body from a frontmattered draft and falls back to raw text", () => {
    const draft = createDraft({
      sceneStem: "01-prologue",
      format: "novel",
      generatedAt: "2026-05-03T14:00:00.000Z",
      body: "샘플 원고입니다.\n"
    })

    expect(extractDraftBody(serializeDraft(draft))).toBe("샘플 원고입니다.\n")
    expect(extractDraftBody("frontmatter 없는 초안\n")).toBe("frontmatter 없는 초안\n")
  })
})

describe("draft warnings", () => {
  it("round-trips warnings through the header", () => {
    const draft = createDraft({
      sceneStem: "01-a",
      format: "novel",
      body: "본문",
      warnings: ["2구간: 뼈대에 없는 인물이 등장합니다 (박민서)"]
    })

    const serialized = serializeDraft(draft)
    expect(serialized).toContain("warnings:")
    expect(serialized).toContain("박민서")

    expect(parseDraft(serialized).warnings).toEqual([
      "2구간: 뼈대에 없는 인물이 등장합니다 (박민서)"
    ])
  })

  it("omits the field when there is nothing to warn about", () => {
    const clean = serializeDraft(createDraft({ sceneStem: "01-a", format: "novel", body: "본문" }))

    expect(clean).not.toContain("warnings")
    expect(parseDraft(clean).warnings).toBeUndefined()
  })

  it("drops an empty warning list rather than writing an empty field", () => {
    const draft = createDraft({ sceneStem: "01-a", format: "novel", body: "본문", warnings: [] })

    expect(serializeDraft(draft)).not.toContain("warnings")
  })
})
