import { describe, expect, it } from "vitest"

import { PersonaDialoguePrompt, SituationExtractionPrompt } from '@storyboard/story-ai';
import type { StyleDirective } from '@storyboard/story-ai';
import type { Background } from '@storyboard/story-format';
const ANTI_DRIFT_LINE = "상황과 페르소나에 주어진 사실만 사용하고, 입력에 없는 새로운 사건·설정·인물·배경을 지어내지 마라."
const POV_INTERIORITY_LINE = "시점 화자의 내면 독백(생각·판단·자기합리화·감정)을 대사 사이에 충분히 녹여라."
const PRESERVE_CONFRONTATION_LINE = "상황에 인물의 폭언·별칭·직접 대사가 드러나면 순화하거나 화해로 덮지 말고 그 표현을 그대로 살려 대사로 옮겨라."
const PRESENT_ONLY_CHARACTERS_LINE =
  "상황에서 이름만 언급되거나 아직 도착하지 않은(앞으로 올) 인물은 그 장면에 등장시키거나 대사를 주지 마라. 실제로 그 자리에 있는 인물만 다뤄라."
const SCENE_CRAFT_LINES = [
  "대사가 적거나 없는 행동·전환 비트(혼자 걷는 길, 잠긴 문, 문이 열리는 순간 등)도 생략하지 말고 장면으로 충실히 그려라.",
  "이전 장면과 시간·장소·등장인물이 바뀌면 그 전환(이동·시간 경과·도착)을 먼저 묘사하고, 이어지는 장면이면 도입을 반복하지 말고 자연스럽게 연결하라.",
  "인물의 성격·사연·감정은 한꺼번에 설명하지 말고 행동과 대사로 조금씩 드러내며 장면이 진행될수록 긴장을 쌓아라."
]
const COMPLETENESS_LINE = "모든 사건을 등장 순서대로 빠짐없이 담되, 한 문장·한 동작 단위로 과도하게 쪼개지 말고 의미 있는 장면 단위로 묶어라."
const KNOWLEDGE_BOUNDARY_LINE =
  "각 인물은 자신이 직접 겪었거나 이전 장면에서 알게 된 정보만 안다. 다른 인물의 페르소나에만 적힌 사실(직업·과거·비밀 등)을 당사자가 밝히기 전에 알거나 언급하게 하지 마라."
const META_BLOCK_GUARD_LINE =
  "[필요 설정]·[회수할 복선] 블록은 장면의 배경 전제와 작가 메모다. 그 내용을 사건으로 추출하지 말고, 본문이 서술하는 실제 사건만 담아라."

const background: Background = {
  type: "location",
  id: "school",
  name: "학교",
  locationKind: "place",
  description: ["교실"],
  characterIds: [],
  tags: []
}

const personas = new Map([["엘리아", "나는 침착하다."]])

function buildDialogue(
  variant: "generic" | "xs" | "rich",
  style?: StyleDirective
): ReturnType<typeof PersonaDialoguePrompt.build> {
  return PersonaDialoguePrompt.build("엘리아가 문을 연다.", personas, background, undefined, variant, style)
}

describe("PersonaDialoguePrompt anti-drift line", () => {
  it("includes the anti-drift line for generic and rich variants", () => {
    expect(buildDialogue("generic").system).toContain(ANTI_DRIFT_LINE)
    expect(buildDialogue("rich").system).toContain(ANTI_DRIFT_LINE)
  })

  it("omits the anti-drift line for the xs variant", () => {
    expect(buildDialogue("xs").system).not.toContain(ANTI_DRIFT_LINE)
  })
})

describe("PersonaDialoguePrompt preserve-confrontation line", () => {
  it("includes the preserve-confrontation line for generic and rich variants", () => {
    expect(buildDialogue("generic").system).toContain(PRESERVE_CONFRONTATION_LINE)
    expect(buildDialogue("rich").system).toContain(PRESERVE_CONFRONTATION_LINE)
  })

  it("omits the preserve-confrontation line for the xs variant", () => {
    expect(buildDialogue("xs").system).not.toContain(PRESERVE_CONFRONTATION_LINE)
  })
})

describe("PersonaDialoguePrompt present-only-characters line", () => {
  it("includes the present-only-characters line for generic and rich variants", () => {
    expect(buildDialogue("generic").system).toContain(PRESENT_ONLY_CHARACTERS_LINE)
    expect(buildDialogue("rich").system).toContain(PRESENT_ONLY_CHARACTERS_LINE)
  })

  it("omits the present-only-characters line for the xs variant", () => {
    expect(buildDialogue("xs").system).not.toContain(PRESENT_ONLY_CHARACTERS_LINE)
  })
})

describe("PersonaDialoguePrompt scene-craft lines", () => {
  it.each(SCENE_CRAFT_LINES)("includes the scene-craft line for generic and rich variants: %s", (line) => {
    expect(buildDialogue("generic").system).toContain(line)
    expect(buildDialogue("rich").system).toContain(line)
  })

  it.each(SCENE_CRAFT_LINES)("omits the scene-craft line for the xs variant: %s", (line) => {
    expect(buildDialogue("xs").system).not.toContain(line)
  })
})

describe("PersonaDialoguePrompt pov interiority line", () => {
  it("includes the interiority line when pov is first", () => {
    expect(buildDialogue("generic", { pov: "first" }).system).toContain(POV_INTERIORITY_LINE)
  })

  it("includes the interiority line when pov is third-limited", () => {
    expect(buildDialogue("generic", { pov: "third-limited" }).system).toContain(POV_INTERIORITY_LINE)
  })

  it("omits the interiority line when style is undefined", () => {
    expect(buildDialogue("generic").system).not.toContain(POV_INTERIORITY_LINE)
  })

  it("omits the interiority line when pov is third-omniscient", () => {
    expect(buildDialogue("generic", { pov: "third-omniscient" }).system).not.toContain(POV_INTERIORITY_LINE)
  })

  it("omits the interiority line for the xs variant even when pov is first", () => {
    expect(buildDialogue("xs", { pov: "first" }).system).not.toContain(POV_INTERIORITY_LINE)
  })
})

describe("SituationExtractionPrompt completeness line", () => {
  it("includes the completeness line in the generic variant", () => {
    expect(SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "generic").system).toContain(COMPLETENESS_LINE)
  })

  it("omits the completeness line in the xs variant", () => {
    expect(SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "xs").system).not.toContain(COMPLETENESS_LINE)
  })
})

describe("PersonaDialoguePrompt knowledge-boundary line", () => {
  it("includes the knowledge-boundary line for generic and rich variants", () => {
    expect(buildDialogue("generic").system).toContain(KNOWLEDGE_BOUNDARY_LINE)
    expect(buildDialogue("rich").system).toContain(KNOWLEDGE_BOUNDARY_LINE)
  })

  it("omits the knowledge-boundary line for the xs variant", () => {
    expect(buildDialogue("xs").system).not.toContain(KNOWLEDGE_BOUNDARY_LINE)
  })
})

describe("SituationExtractionPrompt meta-block guard line", () => {
  it("includes the meta-block guard line in the generic variant", () => {
    expect(SituationExtractionPrompt.build("[필요 설정]\n- 규칙\n\n엘리아가 들어온다.", "generic").system).toContain(
      META_BLOCK_GUARD_LINE
    )
  })

  it("omits the meta-block guard line in the xs variant", () => {
    expect(SituationExtractionPrompt.build("엘리아가 교실로 들어온다.", "xs").system).not.toContain(META_BLOCK_GUARD_LINE)
  })
})
