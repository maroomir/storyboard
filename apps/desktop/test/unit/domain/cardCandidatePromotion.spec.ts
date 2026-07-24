import { describe, expect, it } from "vitest"

import {
  applyCardCandidateItems,
  cardCandidateItemKey,
  collectCardCandidateItems,
  pruneRecordByPromotedKeys,
  selectNewCardCandidateItems
} from "@/domain/cardCandidatePromotion"
import type { CardCandidateRecord } from "@/shared/cardCandidates"
import type { CharacterCard } from '@storyboard/story-format';

function record(sceneStem: string, characters: CardCandidateRecord["characters"]): CardCandidateRecord {
  return { sceneStem, generatedAt: "2026-06-25T00:00:00.000Z", characters }
}

describe("cardCandidatePromotion", () => {
  it("flattens and dedupes candidate items across records", () => {
    const items = collectCardCandidateItems([
      record("01-a", [
        { cardId: "elia", attributes: [{ key: "나이", value: "17" }], relations: [{ target: "jihoon", type: "친구" }], arc: [] }
      ]),
      record("02-b", [
        { cardId: "elia", attributes: [{ key: "나이", value: "17" }], relations: [], arc: [{ summary: "재회", sceneRef: "02-b" }] }
      ])
    ])

    expect(items).toHaveLength(3)
    expect(items.filter((item) => item.kind === "attribute")).toHaveLength(1)
  })

  it("filters out items already present on the card", () => {
    const card: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      attributes: { 나이: "17" },
      relations: [{ target: "jihoon", type: "친구" }]
    }

    const items = collectCardCandidateItems([
      record("01-a", [
        {
          cardId: "elia",
          attributes: [{ key: "나이", value: "18" }],
          relations: [{ target: "jihoon", type: "친구" }],
          arc: [{ summary: "새 장면", sceneRef: "01-a" }]
        }
      ])
    ])

    const fresh = selectNewCardCandidateItems(items, new Map([["elia", card]]))

    expect(fresh.map((item) => item.kind)).toEqual(["arc"])
  })

  it("merges picked items without overwriting existing attributes", () => {
    const card: CharacterCard = { type: "character", id: "elia", name: "엘리아", attributes: { 나이: "17" } }

    const items = collectCardCandidateItems([
      record("01-a", [
        {
          cardId: "elia",
          attributes: [
            { key: "나이", value: "18" },
            { key: "키", value: "160" }
          ],
          relations: [{ target: "jihoon", type: "친구" }],
          arc: [{ summary: "등교", sceneRef: "01-a" }]
        }
      ])
    ])

    const merged = applyCardCandidateItems(card, items)

    expect(merged.attributes).toEqual({ 나이: "17", 키: "160" })
    expect(merged.relations).toEqual([{ target: "jihoon", type: "친구" }])
    expect(merged.arc).toEqual([{ stage: "01-a", summary: "등교", sceneRef: "01-a" }])
  })

  it("removes promoted items and drops fully promoted characters", () => {
    const input = record("01-a", [
      {
        cardId: "elia",
        attributes: [
          { key: "나이", value: "17" },
          { key: "키", value: "160" }
        ],
        relations: [{ target: "jihoon", type: "친구" }],
        arc: [{ summary: "등교", sceneRef: "01-a" }]
      },
      {
        cardId: "jihoon",
        attributes: [],
        relations: [{ target: "elia", type: "친구" }],
        arc: []
      }
    ])

    const items = collectCardCandidateItems([input])
    const promotedKeys = new Set(
      items
        .filter(
          (item) =>
            (item.cardId === "elia" && item.kind === "attribute" && item.key === "나이") ||
            (item.cardId === "elia" && item.kind === "arc") ||
            item.cardId === "jihoon"
        )
        .map(cardCandidateItemKey)
    )

    const pruned = pruneRecordByPromotedKeys(input, promotedKeys)

    expect(pruned.characters).toHaveLength(1)
    expect(pruned.characters[0]).toMatchObject({
      cardId: "elia",
      attributes: [{ key: "키", value: "160" }],
      relations: [{ target: "jihoon", type: "친구" }],
      arc: []
    })
  })
})
