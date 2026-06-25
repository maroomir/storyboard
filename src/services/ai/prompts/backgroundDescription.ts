import type { Background } from "@/domain/Background"
import { joinCardText } from "@/shared/card"
import { type PromptArtifact, type PromptVariantId } from "./types"

export const BackgroundDescriptionPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 400
  },
  build(background: Background, variant: PromptVariantId = "generic"): PromptArtifact {
    const description = joinCardText(background.description)
    const parts = [
      `이름: ${background.name}`,
      `유형: ${background.type}`,
      description ? `설명: ${description}` : undefined,
      background.tags && background.tags.length > 0 ? `태그: ${background.tags.join(", ")}` : undefined
    ].filter((part): part is string => Boolean(part))

    return variant === "xs" ? buildXs(parts) : buildGeneric(parts)
  }
} as const

function buildGeneric(parts: readonly string[]): PromptArtifact {
  return {
    system: [
      "배경 카드를 바탕으로 장소·시대의 분위기와 감각 묘사를 작성하라.",
      "시각·청각·후각·촉각 중 어울리는 감각을 골라 공간의 인상을 한국어로 그려라.",
      "사건이나 인물을 지어내지 말고 배경 자체의 분위기만 묘사하라.",
      "설명·머리말 없이 묘사 본문만 2~4문장으로 출력하라."
    ].join("\n"),
    user: parts.join("\n")
  }
}

function buildXs(parts: readonly string[]): PromptArtifact {
  return {
    system: "배경의 장소·시대 분위기를 2~3문장 감각 묘사로. 한국어, 묘사 본문만.",
    user: parts.join("\n")
  }
}
