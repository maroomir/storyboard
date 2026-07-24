import { describe, expect, it } from "vitest"

import { DraftExpansionPrompt, GenreFormattingPrompt, GrammarCheckPrompt, InlineCompletionPrompt, PersonaDialoguePrompt, PersonaGenerationPrompt, SituationExtractionPrompt, TraitsExtractionPrompt } from '@storyboard/story-ai';
import type { Background, Character } from '@storyboard/story-format';
import type { ProjectFormat } from '@storyboard/story-format';

describe("AI prompts", () => {
  const character: Character = {
    type: "character",
    id: "elia",
    name: "엘리아",
    profile: "profile/elia.png",
    role: "main",
    attributes: {},
    description: ["주인공"],
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
    description: ["교실"],
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

  it("preserves full coverage and raw confrontation in the rich genre formatting, but not in xs", () => {
    const noCompressionLine =
      "입력의 모든 장면과 대사를 빠짐없이 포함하고 요약하거나 압축하지 마라. 다만 분량을 임의로 부풀리지 말고 입력의 밀도와 호흡을 유지하라."
    const rawConfrontationLine = "인물의 폭언·별칭·갈등·실망 같은 거친 표현은 순화하거나 화해로 덮지 말고 그 강도 그대로 살려라."
    const sceneDelineationLine =
      "시간·장소가 바뀌는 지점에서 장면을 명확히 구분하고, 각 장면의 도입(등장 경위·공간)과 장면 사이의 전환을 자연스럽게 이어라. 대사 없이 행동만 있는 대목도 장면으로 살려 두어라."
    const noMetaLeakLine =
      "오직 완성된 소설 본문만 출력하라. 분량·토큰·작업 방식에 대한 안내, 연재형/압축형 같은 선택지 제시, 사용자에게 묻는 말 등 어떤 메타 설명도 출력하지 마라."
    const noDividerLine = "장면 구분은 빈 줄로만 하고 ---, *** 같은 기호 구분선은 쓰지 마라."
    const noRepetitionLine = "같은 표현이나 상투구를 반복하지 말고 변주하라."

    const rich = GenreFormattingPrompt.build("조만재: 안녕", "novel", "rich", { genre: "허세 코미디" })
    expect(rich.system).toContain(noCompressionLine)
    expect(rich.system).toContain(rawConfrontationLine)
    expect(rich.system).toContain(sceneDelineationLine)
    expect(rich.system).toContain(noMetaLeakLine)
    expect(rich.system).toContain(noDividerLine)
    expect(rich.system).toContain(noRepetitionLine)

    const xs = GenreFormattingPrompt.build("조만재: 안녕", "novel", "xs")
    expect(xs.system).not.toContain(noCompressionLine)
    expect(xs.system).not.toContain(rawConfrontationLine)
    expect(xs.system).not.toContain(sceneDelineationLine)
    expect(xs.system).not.toContain(noMetaLeakLine)
    expect(xs.system).not.toContain(noDividerLine)
    expect(xs.system).not.toContain(noRepetitionLine)
  })

  it("includes character voice in the persona prompt and instructs reflecting it", () => {
    const voiced: Character = { ...character, voice: ["1인칭 허세 만연체"] }
    const prompt = PersonaGenerationPrompt.build(voiced, "generic")
    expect(prompt.user).toContain("목소리·말투: 1인칭 허세 만연체")
    expect(prompt.system).toContain("화법과 어조")
  })
})
