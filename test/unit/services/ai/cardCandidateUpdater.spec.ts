import { describe, expect, it } from "vitest"

import { updateCardCandidatesFromDraft } from "@/services/ai/cardCandidateUpdater"
import type { StoryboardAIService } from "@/services/ai/AIService"
import type { CardCandidateFileSystem } from "@/domain/files/cardCandidates"
import type { CharacterCard } from "@/shared/card"
import type { CardCandidateExtraction } from "@/services/ai/prompts/cardCandidateExtraction"

const elia: CharacterCard = { type: "character", id: "elia", name: "엘리아" }

class CaptureFileSystem implements CardCandidateFileSystem {
  public readonly written = new Map<string, string>()

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const content = this.written.get(uri as string)
    if (!content) {
      throw new Error(`File not found: ${uri as string}`)
    }
    return new TextEncoder().encode(content)
  }

  public async writeFile(uri: unknown, content: Uint8Array): Promise<void> {
    this.written.set(uri as string, new TextDecoder().decode(content))
  }
}

function createService(
  byName: Readonly<Record<string, CardCandidateExtraction>>,
  verify?: (statements: readonly string[]) => number[] | null
): Pick<StoryboardAIService, "extractCardCandidatesByCharacter" | "verifyCardCandidatesByCharacter"> {
  return {
    extractCardCandidatesByCharacter: async (_draftBody, names) =>
      Object.fromEntries(names.map((name) => [name, byName[name] ?? { attributes: [], relations: [], description: [], voice: [], desire: [] }])),
    verifyCardCandidatesByCharacter: async (_draftBody, _name, statements) =>
      verify ? verify(statements) : statements.map((_statement, index) => index)
  }
}

describe("updateCardCandidatesFromDraft", () => {
  it("resolves relation targets to ids, injects sceneRef, and writes candidates", async () => {
    const fileSystem = new CaptureFileSystem()

    const summary = await updateCardCandidatesFromDraft({
      sceneStem: "01-prologue",
      draftBody: "엘리아가 지훈을 만났다.",
      detectedCharacterCards: [elia],
      characterRoster: [
        { id: "elia", name: "엘리아" },
        { id: "jihoon", name: "지훈" }
      ],
      aiService: createService({
        엘리아: {
          attributes: [{ key: "나이", value: "17" }],
          relations: [
            { target: "지훈", type: "친구" },
            { target: "존재하지않는인물", type: "적" },
            { target: "엘리아", type: "자기참조" }
          ],
          description: [],
          voice: [],
          desire: [],
          arc: { summary: "학교에 도착해 친구를 만남" }
        }
      }),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/cards/${stem}.json`
    })

    expect(summary).toEqual({ characterCount: 1, candidateCount: 3 })

    const written = JSON.parse(fileSystem.written.get("/cache/cards/01-prologue.json") ?? "{}")
    expect(written.characters[0]).toMatchObject({
      cardId: "elia",
      attributes: [{ key: "나이", value: "17" }],
      relations: [{ target: "jihoon", type: "친구" }],
      arc: [{ summary: "학교에 도착해 친구를 만남", sceneRef: "01-prologue" }]
    })
  })

  it("skips writing when extraction yields nothing usable", async () => {
    const fileSystem = new CaptureFileSystem()

    const summary = await updateCardCandidatesFromDraft({
      sceneStem: "02-quiet",
      draftBody: "배경 묘사뿐.",
      detectedCharacterCards: [elia],
      characterRoster: [{ id: "elia", name: "엘리아" }],
      aiService: createService({ 엘리아: { attributes: [], relations: [], description: [], voice: [], desire: [] } }),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/cards/${stem}.json`
    })

    expect(summary).toEqual({ characterCount: 0, candidateCount: 0 })
    expect(fileSystem.written.size).toBe(0)
  })

  it("keeps only verified candidates when verification approves a subset", async () => {
    const fileSystem = new CaptureFileSystem()

    const summary = await updateCardCandidatesFromDraft({
      sceneStem: "03-verify",
      draftBody: "엘리아가 지훈을 만났다.",
      detectedCharacterCards: [elia],
      characterRoster: [
        { id: "elia", name: "엘리아" },
        { id: "jihoon", name: "지훈" }
      ],
      verify: true,
      aiService: createService(
        {
          엘리아: {
            attributes: [{ key: "나이", value: "17" }],
            relations: [{ target: "지훈", type: "친구" }],
            description: [],
            voice: [],
            desire: [],
            arc: { summary: "본문에 없는 추측" }
          }
        },
        () => [1]
      ),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/cards/${stem}.json`
    })

    expect(summary).toEqual({ characterCount: 1, candidateCount: 1 })

    const written = JSON.parse(fileSystem.written.get("/cache/cards/03-verify.json") ?? "{}")
    expect(written.characters[0]).toMatchObject({
      cardId: "elia",
      attributes: [],
      relations: [{ target: "jihoon", type: "친구" }],
      arc: []
    })
  })

  it("keeps all candidates when verification returns no verdict", async () => {
    const fileSystem = new CaptureFileSystem()

    const summary = await updateCardCandidatesFromDraft({
      sceneStem: "04-fallback",
      draftBody: "엘리아가 지훈을 만났다.",
      detectedCharacterCards: [elia],
      characterRoster: [
        { id: "elia", name: "엘리아" },
        { id: "jihoon", name: "지훈" }
      ],
      verify: true,
      aiService: createService(
        {
          엘리아: {
            attributes: [{ key: "나이", value: "17" }],
            relations: [{ target: "지훈", type: "친구" }],
            description: [],
            voice: [],
            desire: [],
            arc: { summary: "학교에 도착" }
          }
        },
        () => null
      ),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/cards/${stem}.json`
    })

    expect(summary).toEqual({ characterCount: 1, candidateCount: 3 })
  })
})
