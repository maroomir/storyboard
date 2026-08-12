import { describe, expect, it } from "vitest"

import { DraftExpansionPrompt, GenreFormattingPrompt, GrammarCheckPrompt, InlineCompletionPrompt, PersonaDialoguePrompt, PersonaGenerationPrompt, SituationExtractionPrompt, TraitsExtractionPrompt } from '@storyboard/story-ai';
import type { PromptArtifact, PromptVariantId } from '@storyboard/story-ai';
import type { Background, Character } from '@seedkernel/wasm';
import type { ProjectFormat } from '@seedkernel/wasm';

interface PromptLengthSample {
  readonly name: string
  readonly build: (variant: PromptVariantId) => PromptArtifact
}

describe("prompt length dump", () => {
  const character: Character = {
    type: "character",
    id: "elia",
    name: "엘리아",
    profile: "profile/elia.png",
    role: "main",
    attributes: {},
    description: ["차분한 주인공"],
    tags: [],
    traits: ["용감함", "신중함"],
    relations: [],
    arc: [],
    recentDialogues: []
  }

  const background: Background = {
    type: "location",
    id: "school",
    name: "학교",
    locationKind: "place",
    description: ["교실"],
    characterIds: [],
    tags: []
  }

  const format: ProjectFormat = "screenplay"
  const personas = new Map([["엘리아", "나는 침착하고 책임감이 강하다."]])

  const samples: readonly PromptLengthSample[] = [
    {
      name: "situationExtraction",
      build: (v): PromptArtifact => SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", v)
    },
    {
      name: "personaGeneration",
      build: (v): PromptArtifact => PersonaGenerationPrompt.build(character, v)
    },
    {
      name: "personaDialogue",
      build: (v): PromptArtifact =>
        PersonaDialoguePrompt.build("엘리아가 문을 연다.", personas, background, undefined, v)
    },
    {
      name: "genreFormatting",
      build: (v): PromptArtifact => GenreFormattingPrompt.build("엘리아: 안녕", format, v)
    },
    {
      name: "traitsExtraction",
      build: (v): PromptArtifact => TraitsExtractionPrompt.build("엘리아가 웃는다.", "엘리아", undefined, v)
    },
    {
      name: "grammarCheck",
      build: (v): PromptArtifact => GrammarCheckPrompt.build("이건 정말루 중요해.", v)
    },
    {
      name: "inlineCompletion",
      build: (v): PromptArtifact =>
        InlineCompletionPrompt.build("그는 창밖을 봤다.", { activeCharacter: "엘리아" }, v)
    },
    {
      name: "draftExpansion",
      build: (v): PromptArtifact =>
        DraftExpansionPrompt.build("그는 문을 열었다.", { background: "교실" }, v)
    }
  ]

  it("xs system block is shorter than generic for every prompt", () => {
    for (const { name, build } of samples) {
      const generic = build("generic")
      const xs = build("xs")
      expect(xs.system.length, `${name} xs system >= generic`).toBeLessThan(generic.system.length)
    }
  })

  it("dumps generic vs xs system lengths for token-saving review", () => {
    const lines: string[] = ["prompt | generic | xs | savings"]
    let totalGeneric = 0
    let totalXs = 0

    for (const { name, build } of samples) {
      const generic = build("generic").system.length
      const xs = build("xs").system.length
      totalGeneric += generic
      totalXs += xs
      const saved = generic - xs
      const ratio = ((saved / generic) * 100).toFixed(1)
      lines.push(`${name} | ${generic} | ${xs} | -${saved} (${ratio}%)`)
    }

    const totalSaved = totalGeneric - totalXs
    const totalRatio = ((totalSaved / totalGeneric) * 100).toFixed(1)
    lines.push(`TOTAL | ${totalGeneric} | ${totalXs} | -${totalSaved} (${totalRatio}%)`)

    console.info(lines.join("\n"))

    expect(totalXs).toBeLessThan(totalGeneric)
  })
})
