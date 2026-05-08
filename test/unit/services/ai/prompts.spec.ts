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
    type: "background",
    id: "school",
    name: "학교",
    concept: "concept/school.png",
    description: "교실",
    tags: [],
    country: "KR",
    category: "학원물"
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
})
import { describe, expect, it } from "vitest"

import { DraftExpansionPrompt } from "@/services/ai/prompts/draftExpansion"
import { GenreFormattingPrompt } from "@/services/ai/prompts/genreFormatting"
import { GrammarCheckPrompt } from "@/services/ai/prompts/grammarCheck"
import { InlineCompletionPrompt } from "@/services/ai/prompts/inlineCompletion"
import { PersonaDialoguePrompt } from "@/services/ai/prompts/personaDialogue"
import { PersonaGenerationPrompt } from "@/services/ai/prompts/personaGeneration"
import { SituationExtractionPrompt } from "@/services/ai/prompts/situationExtraction"
import { TraitsExtractionPrompt } from "@/services/ai/prompts/traitsExtraction"
import type { Background } from "@/domain/Background"
import type { Character } from "@/domain/Character"
import type { ProjectFormat } from "@/shared/project"

describe("AI prompts", () => {
  const character: Character = {
    type: "character",
    id: "elia",
    name: "엘리아",
    description: "주인공",
    tags: [],
    traits: ["용감함"],
    relations: [],
    arc: [],
    recentDialogues: []
  }
  const background: Background = {
    type: "background",
    id: "school",
    name: "학교",
    description: "교실",
    tags: [],
    country: "KR",
    category: "학원물",
    atmosphere: undefined,
    constraints: [],
    props: []
  }
  const format: ProjectFormat = "screenplay"

  it("returns prompt artifacts for all builders", () => {
    const artifacts = [
      SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "generic"),
      PersonaGenerationPrompt.build(character, "generic"),
      PersonaDialoguePrompt.build("엘리아가 문을 연다.", new Map([["엘리아", "나는 침착하다."]]), background, undefined, "generic"),
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
})
