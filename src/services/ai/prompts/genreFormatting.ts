import type { ProjectFormat } from "@/shared/project"
import { type PromptArtifact, type PromptVariantId } from "./types"

const formatGuides: Readonly<Record<ProjectFormat, string>> = {
  novel: "소설 형식으로 자연스럽게 서술하세요.",
  screenplay: "시나리오 형식으로 대사와 행동을 명확히 구분하세요.",
  play: "희곡 형식으로 '인물명: 대사'와 지문 중심으로 작성하세요.",
  essay: "수필 형식으로 서술 중심으로 재작성하세요.",
  poem: "시 형식으로 행과 이미지를 살려 재작성하세요."
}

export const GenreFormattingPrompt = {
  config: {
    temperature: 0.5,
    maxTokens: 12000
  },
  build(dialogue: string, format: ProjectFormat, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(dialogue, format) : buildGeneric(dialogue, format)
  }
} as const

function buildGeneric(dialogue: string, format: ProjectFormat): PromptArtifact {
  return {
    system: [
      `전문 작가처럼 장면을 ${format} 형식으로 재작성하라.`,
      formatGuides[format],
      "원문의 대사와 장면 의미는 유지하고 형식만 조정하라.",
      "출력은 한국어로 작성하라."
    ].join("\n"),
    user: dialogue
  }
}

function buildXs(dialogue: string, format: ProjectFormat): PromptArtifact {
  return {
    system: [`${format} 형식으로 재작성. 의미 유지, 형식만 변경, 한국어 출력.`].join("\n"),
    user: dialogue
  }
}
