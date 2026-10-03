import { describe, expect, it } from "vitest"

import { parseCardCandidates, serializeCardCandidates } from "@storyboard/story-model"
import type { CardCandidateRecord } from "@storyboard/story-model"

describe("card candidate codec", () => {
  it("round-trips a candidate record through serialize and parse", () => {
    const record: CardCandidateRecord = {
      sceneStem: "01-prologue",
      generatedAt: "2026-06-25T00:00:00.000Z",
      characters: [
        {
          cardId: "elia",
          attributes: [{ key: "나이", value: "17" }],
          relations: [{ target: "jihoon", type: "친구" }],
          arc: [{ summary: "학교에 도착", sceneRef: "01-prologue" }]
        }
      ]
    }

    expect(parseCardCandidates(serializeCardCandidates(record))).toEqual(record)
  })

  it("applies array defaults for omitted candidate fields", () => {
    const parsed = parseCardCandidates(
      JSON.stringify({
        sceneStem: "02-quiet",
        generatedAt: "2026-06-25T00:00:00.000Z",
        characters: [{ cardId: "elia" }]
      })
    )

    expect(parsed.characters[0]).toEqual({ cardId: "elia", attributes: [], relations: [], arc: [] })
  })
})
