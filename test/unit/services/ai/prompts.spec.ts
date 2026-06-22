import { describe, expect, it } from "vitest"

import type { Background } from "@/domain/Background"
import type { Character } from "@/domain/Character"
import { DraftExpansionPrompt } from "@/services/ai/prompts/draftExpansion"
import { GenreFormattingPrompt } from "@/services/ai/prompts/genreFormatting"
import { GrammarCheckPrompt } from "@/services/ai/prompts/grammarCheck"
import { InlineCompletionPrompt } from "@/services/ai/prompts/inlineCompletion"
import { PersonaDialoguePrompt } from "@/services/ai/prompts/personaDialogue"
import { PersonaGenerationPrompt } from "@/services/ai/prompts/personaGeneration"
import { SituationExtractionPrompt } from "@/services/ai/prompts/situationExtraction"
import { TraitsExtractionPrompt } from "@/services/ai/prompts/traitsExtraction"
import type { ProjectFormat } from "@/shared/project"

describe("AI prompts", () => {
  const character: Character = {
    type: "character",
    id: "elia",
    name: "엘리아",
    profile: "profile/elia.png",
    role: "main",
    attributes: {},
    description: "주인공",
    tags: [],
    traits: ["용감함"],
    relations: [],
    arc: [],
    recentDialogues: []
  }

  const background: Background = {
    type: "location",
    id: "school",
    name: "학교",
    locationKind: "place",
    description: "교실",
    characterIds: [],
    tags: []
  }

  const format: ProjectFormat = "screenplay"

  it("returns prompt artifacts for all builders", () => {
    const artifacts = [
      SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "generic"),
      PersonaGenerationPrompt.build(character, "generic"),
      PersonaDialoguePrompt.build(
        "엘리아가 문을 연다.",
        new Map([["엘리아", "나는 침착하다."]]),
        background,
        undefined,
        "generic"
      ),
      GenreFormattingPrompt.build("엘리아: 안녕", format, "generic"),
      TraitsExtractionPrompt.build("엘리아가 웃는다.", "엘리아", undefined, "generic"),
      GrammarCheckPrompt.build("이건 정말루 중요해.", "generic"),
      InlineCompletionPrompt.build("그는 창밖을 봤다.", { activeCharacter: "엘리아" }, "generic"),
      DraftExpansionPrompt.build("그는 문을 열었다.", { background: "교실" }, "generic")
    ]

    for (const artifact of artifacts) {
      expect(artifact.system.length).toBeGreaterThan(0)
      expect(artifact.user.length).toBeGreaterThan(0)
    }
  })

  it("keeps dynamic input in user and shortens xs prompts", () => {
    const samples = [
      {
        generic: SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "generic"),
        xs: SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "xs"),
        input: "엘리아가 교실로 들어온다."
      },
      {
        generic: GrammarCheckPrompt.build("이건 정말루 중요해.", "generic"),
        xs: GrammarCheckPrompt.build("이건 정말루 중요해.", "xs"),
        input: "이건 정말루 중요해."
      },
      {
        generic: DraftExpansionPrompt.build("그는 문을 열었다.", { background: "교실" }, "generic"),
        xs: DraftExpansionPrompt.build("그는 문을 열었다.", { background: "교실" }, "xs"),
        input: "그는 문을 열었다."
      }
    ]

    for (const { generic, xs, input } of samples) {
      expect(generic.user).toContain(input)
      expect(xs.user).toContain(input)
      expect(xs.system.length).toBeLessThan(generic.system.length)
    }
  })

  it("amplifies novel genre formatting from a compressed scene skeleton", () => {
    const novel = GenreFormattingPrompt.build("조만재: 안녕", "novel", "generic")
    expect(novel.system).toContain("압축된 골자")
    expect(novel.system).toContain("풍부하게")
    expect(novel.system).toContain("새로운 사건·설정·인물은 만들어내지 마라")
  })

  it("includes character voice in the persona prompt and instructs reflecting it", () => {
    const voiced: Character = { ...character, voice: "1인칭 허세 만연체" }
    const prompt = PersonaGenerationPrompt.build(voiced, "generic")
    expect(prompt.user).toContain("목소리·말투: 1인칭 허세 만연체")
    expect(prompt.system).toContain("화법과 어조")
  })
})
