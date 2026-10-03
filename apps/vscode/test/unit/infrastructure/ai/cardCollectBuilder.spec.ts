import { describe, expect, it } from "vitest"

import {
  buildCardCollectProposals,
  filterDraftsForCard,
  type CardCollectAiService,
  type CollectDraft
} from "@storyboard/story-engine"
import type { CharacterCard, LocationBackgroundCard } from '@storyboard/story-model';

const roster = [
  { id: "elia", name: "엘리아" },
  { id: "jihun", name: "지훈" },
  { id: "mina", name: "미나" }
]

function characterAiService(): CardCollectAiService {
  return {
    extractCardCandidatesByCharacter: async (_body, names) =>
      Object.fromEntries(
        names.map((name) => [
          name,
          {
            attributes: [{ key: "height", value: "170" }],
            relations: [{ target: "지훈", type: "friend" }],
            description: ["은빛 머리의 소녀"],
            voice: ["또박또박한 존댓말"],
            desire: ["진실을 밝히고 싶다"],
            arc: { summary: "각성" }
          }
        ])
      ),
    extractTraitsByCharacter: async (_body, names) => Object.fromEntries(names.map((name) => [name, ["신중함"]])),
    extractBackgroundFactsFromDraft: async () => ({ description: [], senses: [], characterNames: [] })
  }
}

describe("filterDraftsForCard", () => {
  it("keeps only drafts mentioning the card name or alias", () => {
    const elia: CharacterCard = { type: "character", id: "elia", name: "엘리아", aliases: ["엘"] }
    const drafts: CollectDraft[] = [
      { sceneStem: "01", body: "엘리아가 등장한다." },
      { sceneStem: "02", body: "지훈만 나온다." },
      { sceneStem: "03", body: "엘이 떠났다." }
    ]

    expect(filterDraftsForCard(elia, drafts).map((draft) => draft.sceneStem)).toEqual(["01", "03"])
  })
})

describe("buildCardCollectProposals (character)", () => {
  it("resolves relation targets, surfaces a changed type as an update, and aggregates source scenes", async () => {
    const elia: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      relations: [{ target: "jihun", type: "지인" }]
    }
    const drafts: CollectDraft[] = [
      { sceneStem: "01", body: "엘리아가 지훈을 만났다." },
      { sceneStem: "02", body: "엘리아가 떠났다." }
    ]

    const proposals = await buildCardCollectProposals({ card: elia, drafts, aiService: characterAiService(), characterRoster: roster })

    const relation = proposals.find((proposal) => proposal.kind === "relation")
    expect(relation).toMatchObject({ target: "jihun", type: "friend", before: "지인" })

    const attribute = proposals.find((proposal) => proposal.kind === "attribute")
    expect(attribute).toMatchObject({ key: "height", value: "170" })
    expect([...(attribute?.sourceScenes ?? [])].sort()).toEqual(["01", "02"])

    expect(proposals.filter((proposal) => proposal.kind === "arc")).toHaveLength(2)
    expect(proposals.filter((proposal) => proposal.kind === "trait")).toHaveLength(1)
    expect(proposals.find((proposal) => proposal.kind === "descriptionLine")).toMatchObject({ value: "은빛 머리의 소녀" })
    expect(proposals.find((proposal) => proposal.kind === "voiceLine")).toMatchObject({ value: "또박또박한 존댓말" })
    expect(proposals.find((proposal) => proposal.kind === "desireLine")).toMatchObject({ value: "진실을 밝히고 싶다" })
  })

  it("forwards aliases to extraction and collects dialogue spoken under an alias name", async () => {
    const jeonghwa: CharacterCard = {
      type: "character",
      id: "jeonghwa-choi",
      name: "최정화",
      aliases: ["엄마"]
    }
    const drafts: CollectDraft[] = [{ sceneStem: "01", body: '엄마: "밥은 먹었니?"' }]

    const receivedAliases: (readonly string[] | undefined)[] = []
    const aiService: CardCollectAiService = {
      extractCardCandidatesByCharacter: async (_body, names, options) => {
        receivedAliases.push(options?.aliases)
        return Object.fromEntries(names.map((name) => [name, { attributes: [], relations: [], description: [], voice: [], desire: [] }]))
      },
      extractTraitsByCharacter: async (_body, _names, options) => {
        receivedAliases.push(options?.aliases)
        return {}
      },
      extractBackgroundFactsFromDraft: async () => ({ description: [], senses: [], characterNames: [] })
    }

    const proposals = await buildCardCollectProposals({ card: jeonghwa, drafts, aiService, characterRoster: roster })

    expect(receivedAliases).toEqual([["엄마"], ["엄마"]])
    expect(proposals.find((proposal) => proposal.kind === "recentDialogue")).toMatchObject({ value: "밥은 먹었니?" })
  })

  it("drops an unchanged relation type for the same target", async () => {
    const elia: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      relations: [{ target: "jihun", type: "friend" }]
    }
    const drafts: CollectDraft[] = [{ sceneStem: "01", body: "엘리아가 지훈을 만났다." }]

    const proposals = await buildCardCollectProposals({ card: elia, drafts, aiService: characterAiService(), characterRoster: roster })

    expect(proposals.some((proposal) => proposal.kind === "relation")).toBe(false)
  })
})

describe("buildCardCollectProposals (background)", () => {
  it("maps character names to ids and filters present values", async () => {
    const library: LocationBackgroundCard = {
      type: "location",
      id: "library",
      name: "도서관",
      description: ["오래된 도서관"],
      characterIds: [],
      tags: [],
      weather: "비",
      locationKind: "place"
    }
    const drafts: CollectDraft[] = [{ sceneStem: "01", body: "도서관에서 만났다." }]

    const aiService: CardCollectAiService = {
      extractCardCandidatesByCharacter: async () => ({}),
      extractTraitsByCharacter: async () => ({}),
      extractBackgroundFactsFromDraft: async () => ({
        description: ["오래된 도서관", "먼지 쌓인 책장"],
        senses: ["곰팡이 냄새"],
        time: "한밤중",
        weather: "맑음",
        characterNames: ["엘리아", "정체불명"]
      })
    }

    const proposals = await buildCardCollectProposals({ card: library, drafts, aiService, characterRoster: roster })
    const kinds = proposals.map((proposal) => proposal.kind).sort()

    expect(kinds).toEqual(["characterId", "descriptionLine", "scalar", "scalar", "sense"])
    expect(proposals.find((proposal) => proposal.kind === "descriptionLine")).toMatchObject({ value: "먼지 쌓인 책장" })
    expect(proposals.find((proposal) => proposal.kind === "characterId")).toMatchObject({ value: "elia" })

    const weather = proposals.find((proposal) => proposal.kind === "scalar" && proposal.field === "weather")
    expect(weather).toMatchObject({ field: "weather", after: "맑음", before: "비" })
  })
})
