import { describe, expect, it } from "vitest"

import { createDraft, serializeDraft } from '@storyboard/story-model';
import { parseDraftSceneParts } from "@/infrastructure/vscode/draftSceneLink"

describe("parseDraftSceneParts", () => {
  it("returns scene parts for a valid draft frontmatter", () => {
    const raw = serializeDraft(
      createDraft({
        sceneStem: "01-prologue",
        format: "novel",
        generatedAt: "2026-05-03T14:00:00.000Z",
        body: "본문\n"
      })
    )

    expect(parseDraftSceneParts(raw)).toEqual({
      stem: "01-prologue",
      order: 1,
      orderText: "01",
      slug: "prologue"
    })
  })

  it("returns undefined when frontmatter is missing or broken (graceful degradation)", () => {
    expect(parseDraftSceneParts("본문만 있음")).toBeUndefined()
    expect(parseDraftSceneParts("---\ninvalid: [\n---\n")).toBeUndefined()
  })

  it("returns undefined when sceneStem does not match scene stem pattern", () => {
    const raw = serializeDraft(
      createDraft({
        sceneStem: "bad_stem",
        format: "novel",
        generatedAt: "2026-05-03T14:00:00.000Z",
        body: "본문\n"
      })
    )

    expect(parseDraftSceneParts(raw)).toBeUndefined()
  })
})
