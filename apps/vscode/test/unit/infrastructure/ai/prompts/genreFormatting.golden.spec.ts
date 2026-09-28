import { describe, expect, it } from "vitest"

import { GenreFormattingPrompt, type StyleDirective } from "@storyboard/story-ai"

describe("GenreFormattingPrompt golden", () => {
  const dialogue = "조만재: 안녕\n엘리아: 반가워"
  const formats = ["novel", "screenplay", "play", "essay", "poem"] as const
  const fullStyle: StyleDirective = {
    narration: {
      person: "first",
      knowledge: "witnessed",
      tense: "past",
      focal: "엘리아",
      voice: ["건조함", "짧은 문장"]
    },
    genre: "허세 코미디",
    styleConstraints: ["간결체", "은유 절제"],
    prohibitions: ["무근거 부활 금지"],
    relationStage: "경계",
    targetWordCount: 12000,
    craftContract: {
      banTelling: false,
      motifRepeatLimit: 2,
      stockGestureBlacklist: [],
      requireCharacterInterior: false,
      actionClarity: false,
      modulateDensity: false
    }
  }
  const genreOnly: StyleDirective = { genre: "로맨스" }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(GenreFormattingPrompt.build(dialogue, "novel", variant, fullStyle)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant without a style", (variant) => {
    expect(GenreFormattingPrompt.build(dialogue, "novel", variant)).toMatchSnapshot()
  })

  it.each(formats)("renders the %s format guide", (format) => {
    expect(GenreFormattingPrompt.build(dialogue, format, "generic")).toMatchSnapshot()
    expect(GenreFormattingPrompt.build(dialogue, format, "rich", genreOnly)).toMatchSnapshot()
    expect(GenreFormattingPrompt.build(dialogue, format, "xs")).toMatchSnapshot()
  })

  it("renders narration-only and knowledge variants", () => {
    expect(
      GenreFormattingPrompt.build(dialogue, "novel", "generic", {
        narration: { person: "third", knowledge: "omniscient" }
      })
    ).toMatchSnapshot()
    expect(
      GenreFormattingPrompt.build(dialogue, "novel", "rich", {
        narration: { person: "second", knowledge: "retrospective" },
        craftContract: { stockGestureBlacklist: ["한숨을 쉬었다"] }
      })
    ).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(GenreFormattingPrompt.build(dialogue, "play")).toMatchSnapshot()
  })
})
