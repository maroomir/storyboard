import { type PromptArtifact, type PromptVariantId } from "./types"

export const SituationExtractionPrompt = {
  config: {
    temperature: 0.3,
    maxTokens: 1000
  },
  build(input: string, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(input) : buildGeneric(input)
  }
} as const

function buildGeneric(input: string): PromptArtifact {
  return {
    system: [
      "사용자 입력에서 상황과 참여 캐릭터를 모두 추출하라.",
      "모든 장면 비트를 등장 순서대로 빠짐없이 추출하고, 임의로 병합하거나 생략하지 마라.",
      "출력은 한국어 JSON 배열만 허용한다.",
      '각 항목: {"characters":string[],"situation":string}.',
      "situation은 가능한 원문 표현을 유지하라."
    ].join("\n"),
    user: ["[입력 본문]", input].join("\n")
  }
}

function buildXs(input: string): PromptArtifact {
  return {
    system: ['상황 추출기. JSON 배열만 출력: {"characters":[],"situation":""}.'].join("\n"),
    user: input
  }
}
