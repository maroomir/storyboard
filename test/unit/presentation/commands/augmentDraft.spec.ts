import { describe, expect, it } from "vitest"

import { buildAugmentLabels } from "@/presentation/commands/augmentDraft"

describe("buildAugmentLabels", () => {
  it("uses edit wording for every scope when an instruction is present", () => {
    expect(buildAugmentLabels("selection", "더 짧게")).toEqual({
      progressTitle: "Storyboard 선택 영역 편집",
      diffTitle: "초안 ↔ 수정 제안",
      confirmPrompt: "수정 결과를 적용하시겠습니까?",
      successMessage: "선택 영역을 수정했습니다."
    })
    expect(buildAugmentLabels("draft", "더 짧게")).toEqual({
      progressTitle: "Storyboard 선택 영역 편집",
      diffTitle: "초안 ↔ 수정 제안",
      confirmPrompt: "수정 결과를 적용하시겠습니까?",
      successMessage: "선택 영역을 수정했습니다."
    })
  })

  it("uses selection-augment wording without an instruction", () => {
    expect(buildAugmentLabels("selection", undefined)).toEqual({
      progressTitle: "Storyboard 선택 영역 보충",
      diffTitle: "초안 ↔ 보충 제안",
      confirmPrompt: "보충 결과를 적용하시겠습니까?",
      successMessage: "선택 영역을 보충했습니다."
    })
  })

  it("uses draft-augment wording without an instruction", () => {
    expect(buildAugmentLabels("draft", undefined)).toEqual({
      progressTitle: "Storyboard 초안 보충",
      diffTitle: "초안 ↔ 보충 제안",
      confirmPrompt: "보충 결과를 적용하시겠습니까?",
      successMessage: "초안을 보충했습니다."
    })
  })
})
