import { describe, expect, it } from "vitest"

import type { Background } from "@/domain/Background"
import { PersonaDialoguePrompt } from "@/services/ai/prompts/personaDialogue"
import { SituationExtractionPrompt } from "@/services/ai/prompts/situationExtraction"
import type { StyleDirective } from "@/shared/styleDirective"

const ANTI_DRIFT_LINE = "상황과 페르소나에 주어진 사실만 사용하고, 입력에 없는 새로운 사건·설정·인물·배경을 지어내지 마라."
const POV_INTERIORITY_LINE = "시점 화자의 내면 독백(생각·판단·자기합리화·감정)을 대사 사이에 충분히 녹여라."
const PRESERVE_CONFRONTATION_LINE = "상황에 인물의 폭언·별칭·직접 대사가 드러나면 순화하거나 화해로 덮지 말고 그 표현을 그대로 살려 대사로 옮겨라."
const COMPLETENESS_LINE = "모든 장면 비트를 등장 순서대로 빠짐없이 추출하고, 임의로 병합하거나 생략하지 마라."

const background: Background = {
  type: "location",
  id: "school",
  name: "학교",
  locationKind: "place",
  description: "교실",
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
