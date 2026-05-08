import type { ProjectFormat } from "@/shared/project"

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
  build(dialogue: string, format: ProjectFormat): string {
    return [
      `당신은 전문 작가입니다. 주어진 장면을 ${format} 형식에 맞게 재작성해주세요.`,
      formatGuides[format],
      "원문의 모든 대사와 장면 의미는 유지하고, 형식만 조정하세요.",
      "한국어로 출력하세요.",
      "",
      dialogue
    ].join("\n")
  }
} as const
