import { describe, expect, it } from "vitest"

import { describeCardPatchSnapshot } from "@webview/lib/cardPatchSnapshot"

describe("describeCardPatchSnapshot", () => {
  it("labels each changed field by its section and lists every value", () => {
    expect(
      describeCardPatchSnapshot([
        { field: "traits", value: ["먼저 말을 건다", "고집이 세다"] },
        { field: "relations", value: [{ target: "sera", type: "소꿉친구" }] },
        { field: "name", value: "엘리아" }
      ])
    ).toEqual([
      { label: "성격", text: "먼저 말을 건다" },
      { label: "성격", text: "고집이 세다" },
      { label: "관계", text: "sera · 소꿉친구" },
      { label: "name", text: "엘리아" }
    ])
  })
})
