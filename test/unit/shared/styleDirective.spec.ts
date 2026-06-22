import { describe, expect, it } from "vitest"

import type { Character } from "@/domain/Character"
import { GenreFormattingPrompt } from "@/services/ai/prompts/genreFormatting"
import { PersonaDialoguePrompt } from "@/services/ai/prompts/personaDialogue"
import { PersonaGenerationPrompt } from "@/services/ai/prompts/personaGeneration"
import type { Background } from "@/domain/Background"
import type { ProjectSetting } from "@/shared/project"
import {
  buildStyleDirective,
  narrativeStyleLines,
  voiceStyleLines,
  type StyleDirective
} from "@/shared/styleDirective"

function settingOf(overrides: Partial<ProjectSetting>): ProjectSetting {
  return { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], ...overrides }
}

const character: Character = {
  type: "character",
  id: "manjae",
  name: "조만재",
  role: "main",
  description: "허세덩어리",
  traits: []
}

const background: Background = {
  type: "location",
  id: "home",
  name: "집",
  locationKind: "place",
  description: "",
  characterIds: [],
  tags: []
}

describe("buildStyleDirective", () => {
  it("returns undefined when setting is missing", () => {
    expect(buildStyleDirective(undefined)).toBeUndefined()
  })

  it("returns undefined when no style fields are present", () => {
    expect(buildStyleDirective(settingOf({}))).toBeUndefined()
  })

  it("maps pov, genre, and non-empty styleConstraints", () => {
    const directive = buildStyleDirective(
      settingOf({ pov: "first", genre: "허세 코미디", styleConstraints: ["1인칭 독백 위주"] })
    )
    expect(directive).toEqual({
      pov: "first",
      genre: "허세 코미디",
      styleConstraints: ["1인칭 독백 위주"]
    })
  })

  it("drops empty styleConstraints to undefined", () => {
    const directive = buildStyleDirective(settingOf({ genre: "로맨스" }))
    expect(directive?.genre).toBe("로맨스")
    expect(directive?.styleConstraints).toBeUndefined()
    expect(directive?.pov).toBeUndefined()
  })
})

describe("style lines", () => {
  const directive: StyleDirective = { pov: "first", genre: "로맨스", styleConstraints: ["간결체"] }

  it("narrativeStyleLines includes pov, genre, and style constraints", () => {
    const lines = narrativeStyleLines(directive)
    expect(lines.some((line) => line.startsWith("서술 시점:"))).toBe(true)
    expect(lines).toContain("장르·톤: 로맨스")
    expect(lines).toContain("문체 제약: 간결체")
  })

  it("voiceStyleLines omits pov but keeps genre and style", () => {
    const lines = voiceStyleLines(directive)
    expect(lines.some((line) => line.startsWith("서술 시점:"))).toBe(false)
    expect(lines).toContain("장르·톤: 로맨스")
    expect(lines).toContain("문체 제약: 간결체")
  })

  it("returns empty arrays for an undefined directive", () => {
    expect(narrativeStyleLines(undefined)).toEqual([])
    expect(voiceStyleLines(undefined)).toEqual([])
  })
})

describe("prompt injection", () => {
  const directive: StyleDirective = { pov: "first", genre: "허세 코미디" }

  it("genre formatting injects narrative pov when style is provided", () => {
    const withStyle = GenreFormattingPrompt.build("조만재: 안녕", "novel", "generic", directive)
    expect(withStyle.system).toContain("서술 시점:")
    expect(withStyle.system).toContain("장르·톤: 허세 코미디")
  })

  it("genre formatting omits pov line when no style is given (back-compat)", () => {
    const noStyle = GenreFormattingPrompt.build("조만재: 안녕", "novel", "generic")
    expect(noStyle.system).not.toContain("서술 시점:")
  })

  it("persona generation reflects tone but not narrative pov", () => {
    const persona = PersonaGenerationPrompt.build(character, "generic", directive)
    expect(persona.system).toContain("장르·톤: 허세 코미디")
    expect(persona.system).not.toContain("서술 시점:")
  })

  it("persona dialogue reflects tone but not narrative pov", () => {
    const dialogue = PersonaDialoguePrompt.build(
      "조만재가 문을 연다.",
      new Map([["조만재", "나는 세기의 철학자다."]]),
      background,
      undefined,
      "generic",
      directive
    )
    expect(dialogue.system).toContain("장르·톤: 허세 코미디")
    expect(dialogue.system).not.toContain("서술 시점:")
  })
})
