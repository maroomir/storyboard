import { describe, expect, it } from "vitest"

import { updateBibleCandidatesFromDraft } from "@/infrastructure/ai/bibleCandidateUpdater"
import type { StoryboardAIService } from "@/infrastructure/ai/AIService"
import type { BibleCandidateFileSystem } from "@/domain/files/bibleCandidates"
import type { CharacterCard } from "@/shared/card"

const eliaCard: CharacterCard = { type: "character", id: "elia", name: "엘리아" }

class CaptureFileSystem implements BibleCandidateFileSystem {
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

function createFactService(
  factsByName: Readonly<Record<string, { key: string; value: string }[]>>
): Pick<StoryboardAIService, "extractFactsByCharacter"> {
  return {
    extractFactsByCharacter: async (_draftBody, characterNames) =>
      Object.fromEntries(characterNames.map((name) => [name, factsByName[name] ?? []]))
  }
}

describe("updateBibleCandidatesFromDraft", () => {
  it("writes candidate facts extracted for detected characters", async () => {
    const fileSystem = new CaptureFileSystem()
    let ensured = false

    const summary = await updateBibleCandidatesFromDraft({
      sceneStem: "01-prologue",
      draftBody: "엘리아가 걸어왔다.",
      detectedCharacterCards: [eliaCard],
      aiService: createFactService({ 엘리아: [{ key: "눈동자 색", value: "녹색" }] }),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/bible/${stem}.json`,
      ensureDirectory: async () => {
        ensured = true
      }
    })

    expect(summary.candidateCount).toBe(1)
    expect(ensured).toBe(true)

    const written = JSON.parse(fileSystem.written.get("/cache/bible/01-prologue.json") ?? "{}")
    expect(written.sceneStem).toBe("01-prologue")
    expect(written.facts[0]).toMatchObject({
      subject: { kind: "character", id: "elia" },
      key: "눈동자 색",
      value: "녹색",
      status: "candidate",
      sourceScene: "01-prologue"
    })
  })

  it("skips writing when no characters are detected", async () => {
    const fileSystem = new CaptureFileSystem()

    const summary = await updateBibleCandidatesFromDraft({
      sceneStem: "01-prologue",
      draftBody: "배경 묘사뿐인 장면.",
      detectedCharacterCards: [],
      aiService: createFactService({}),
      fileSystem,
      resolveCandidateUri: (stem) => `/cache/bible/${stem}.json`
    })

    expect(summary.candidateCount).toBe(0)
    expect(fileSystem.written.size).toBe(0)
  })
})
