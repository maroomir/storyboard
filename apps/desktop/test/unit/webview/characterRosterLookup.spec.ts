import { describe, expect, it } from "vitest"

import { buildCharacterRosterLookup, resolveCharacterDisplayName } from "@webview/lib/characterRosterLookup"

describe("characterRosterLookup", () => {
  it("resolves known character names from roster", () => {
    const lookup = buildCharacterRosterLookup([{ id: "jihoon", name: "지훈", role: "supporting" }])

    expect(resolveCharacterDisplayName("jihoon", lookup)).toEqual({
      displayName: "지훈",
      isKnown: true,
      role: "supporting"
    })
  })

  it("falls back to id when character is missing from roster", () => {
    const lookup = buildCharacterRosterLookup([])

    expect(resolveCharacterDisplayName("missing", lookup)).toEqual({
      displayName: "missing",
      isKnown: false
    })
  })
})
