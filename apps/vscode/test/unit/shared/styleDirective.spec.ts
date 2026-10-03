import { describe, expect, it } from "vitest"

import { buildStyleDirective, describeNarration, GenreFormattingPrompt, narrativeStyleLines, PersonaDialoguePrompt, PersonaGenerationPrompt, proseConventionLines, voiceStyleLines } from '@storyboard/story-ai';
import type { StyleDirective } from '@storyboard/story-ai';
import { resolveNarration } from '@storyboard/story-model';
import type { Background, Character, ProjectSetting } from '@storyboard/story-model';
function settingOf(overrides: Partial<ProjectSetting>): ProjectSetting {
  return { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], ...overrides }
}

const character: Character = {
  type: "character",
  id: "manjae",
  name: "조만재",
  role: "main",
  description: ["허세덩어리"],
  traits: []
}

const background: Background = {
  type: "location",
  id: "home",
  name: "집",
  locationKind: "place",
  description: [],
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

  it("maps narration, genre, and non-empty styleConstraints", () => {
    const directive = buildStyleDirective(
      settingOf({ genre: "허세 코미디", styleConstraints: ["1인칭 독백 위주"] }),
      undefined,
      undefined,
      undefined,
      resolveNarration({ pov: "first" })
    )
    expect(directive).toEqual({
      narration: { person: "first", knowledge: "witnessed", tense: "past" },
      genre: "허세 코미디",
      styleConstraints: ["1인칭 독백 위주"]
    })
  })

  it("drops empty styleConstraints to undefined", () => {
    const directive = buildStyleDirective(settingOf({ genre: "로맨스" }))
    expect(directive?.genre).toBe("로맨스")
    expect(directive?.styleConstraints).toBeUndefined()
    expect(directive?.narration).toBeUndefined()
  })

  it("maps non-empty prohibitions and drops empty ones to undefined", () => {
    const withProhibitions = buildStyleDirective(
      settingOf({ genre: "게임 판타지", prohibitions: ["전지적 정보 금지"] })
    )
    expect(withProhibitions?.prohibitions).toEqual(["전지적 정보 금지"])

    const withoutProhibitions = buildStyleDirective(settingOf({ genre: "게임 판타지" }))
    expect(withoutProhibitions?.prohibitions).toBeUndefined()
  })

  it("carries the focal character resolved from the scene card", () => {
    const directive = buildStyleDirective(
      settingOf({ genre: "게임 판타지" }),
      undefined,
      undefined,
      undefined,
      resolveNarration({ focalFallback: "한이준" })
    )
    expect(directive?.narration?.focal).toBe("한이준")
  })

  it("drops a blank focal character", () => {
    expect(resolveNarration({ focalFallback: "  " })).toBeUndefined()
    expect(buildStyleDirective(undefined, undefined, undefined, undefined, undefined)).toBeUndefined()
  })

  it("returns a directive from prohibitions alone", () => {
    expect(buildStyleDirective(settingOf({ prohibitions: ["무근거 부활 금지"] }))?.prohibitions).toEqual([
      "무근거 부활 금지"
    ])
  })

  it("includes relationStage from scene metadata", () => {
    expect(buildStyleDirective(settingOf({ genre: "로맨스" }), "적대적 첫 만남")?.relationStage).toBe("적대적 첫 만남")
  })

  it("returns a directive from relationStage alone, without setting", () => {
    expect(buildStyleDirective(undefined, "연인")?.relationStage).toBe("연인")
  })

  it("drops a blank relationStage", () => {
    expect(buildStyleDirective(undefined, "   ")).toBeUndefined()
  })

  it("returns a directive from targetWordCount alone, without setting", () => {
    expect(buildStyleDirective(undefined, undefined, 3000)?.targetWordCount).toBe(3000)
  })

  it("drops a non-positive or non-integer targetWordCount", () => {
    expect(buildStyleDirective(undefined, undefined, 0)).toBeUndefined()
    expect(buildStyleDirective(undefined, undefined, -100)).toBeUndefined()
    expect(buildStyleDirective(undefined, undefined, 1500.5)).toBeUndefined()
  })
})

describe("style lines", () => {
  const directive: StyleDirective = {
    narration: { person: "first", knowledge: "witnessed", tense: "past", focal: "한이준", voice: ["건조한 단문"] },
    genre: "로맨스",
    styleConstraints: ["간결체"],
    prohibitions: ["무근거 부활 금지"],
    relationStage: "적대적 첫 만남",
    targetWordCount: 3000
  }

  it("narrativeStyleLines includes narration, genre, style constraints, prohibitions, relation stage, and length", () => {
    const lines = narrativeStyleLines(directive)
    expect(lines.some((line) => line.startsWith("서술 시점:"))).toBe(true)
    expect(lines.some((line) => line.includes("직접 보거나 듣거나 겪은 것만"))).toBe(true)
    expect(lines.some((line) => line.startsWith("서술자의 목소리:") && line.includes("건조한 단문"))).toBe(true)
    expect(lines).toContain("장르·톤: 로맨스")
    expect(lines).toContain("문체 제약: 간결체")
    expect(lines.some((line) => line.includes("금지 규칙") && line.includes("무근거 부활 금지"))).toBe(true)
    expect(lines.some((line) => line.includes("시점 인물") && line.includes("한이준"))).toBe(true)
    expect(lines.some((line) => line.includes("관계 단계"))).toBe(true)
    expect(lines.some((line) => line.includes("목표 분량") && line.includes("3,000자"))).toBe(true)
  })

  it("voiceStyleLines omits narration and length but keeps genre, style, prohibitions, and relation stage", () => {
    const lines = voiceStyleLines(directive)
    expect(lines.some((line) => line.startsWith("서술 시점:"))).toBe(false)
    expect(lines.some((line) => line.startsWith("서술자의 목소리:"))).toBe(false)
    expect(lines).toContain("장르·톤: 로맨스")
    expect(lines).toContain("문체 제약: 간결체")
    expect(lines.some((line) => line.includes("금지 규칙") && line.includes("무근거 부활 금지"))).toBe(true)
    expect(lines.some((line) => line.includes("시점 인물") && line.includes("한이준"))).toBe(true)
    expect(lines.some((line) => line.includes("관계 단계"))).toBe(true)
    expect(lines.some((line) => line.includes("목표 분량"))).toBe(false)
  })

  it("returns empty arrays for an undefined directive", () => {
    expect(narrativeStyleLines(undefined)).toEqual([])
    expect(voiceStyleLines(undefined)).toEqual([])
  })
})

describe("prompt injection", () => {
  const directive: StyleDirective = {
    narration: resolveNarration({ pov: "first" }),
    genre: "허세 코미디"
  }

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

describe("narration rendering", () => {
  it("states the knowledge boundary for each knowledge kind", () => {
    const witnessed = narrativeStyleLines({ narration: { person: "first", knowledge: "witnessed" } })
    expect(witnessed.some((line) => line.includes("알 수 없는 사실을 단정하지 마라"))).toBe(true)

    const omniscient = narrativeStyleLines({ narration: { person: "third", knowledge: "omniscient" } })
    expect(omniscient.some((line) => line.includes("어느 인물의 내면에도 들어갈 수 있고"))).toBe(true)

    const retrospective = narrativeStyleLines({ narration: { person: "first", knowledge: "retrospective" } })
    expect(retrospective.some((line) => line.includes("결말을 이미 아는 자리에서 돌아본다"))).toBe(true)
  })

  it("names the second person explicitly", () => {
    const lines = narrativeStyleLines({ narration: resolveNarration({ pov: "second" }) })
    expect(lines.some((line) => line.includes("2인칭") && line.includes("당신"))).toBe(true)
  })

  it("fixes prose tense to the narrator's tense", () => {
    expect(proseConventionLines("present")[0]).toContain("현재형")
    expect(proseConventionLines()[0]).toContain("과거형")
  })

  it("summarizes a directive for the critique prompt", () => {
    expect(describeNarration({ person: "first", knowledge: "retrospective", focal: "하나", tense: "past" })).toBe(
      "1인칭 · 회고 · 초점 하나 · 과거형"
    )
    expect(describeNarration({})).toBe("지정 없음")
  })
})
