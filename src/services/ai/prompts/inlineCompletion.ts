import { type PromptArtifact, type PromptVariantId } from "./types"

export interface InlineCompletionPromptContext {
  readonly activeCharacter?: string
  readonly background?: string
}

export const InlineCompletionPrompt = {
  config: {
    temperature: 0.5,
    maxTokens: 120
  },
  build(prefix: string, context: InlineCompletionPromptContext = {}, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(prefix, context) : buildGeneric(prefix, context)
  }
} as const

function buildGeneric(prefix: string, context: InlineCompletionPromptContext): PromptArtifact {
  return {
    system: [
      "소설/시나리오 공동 집필 도우미다.",
      "커서 직전 문맥을 이어 한 줄~두 줄의 짧은 텍스트만 제안하라.",
      "설명/따옴표/코드블록 없이 완성 문장만 출력하라."
    ].join("\n"),
    user: [
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      "",
      "[커서 직전 텍스트]",
      prefix
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }
}

function buildXs(prefix: string, context: InlineCompletionPromptContext): PromptArtifact {
  return {
    system: "문맥 이어쓰기 1~2줄. 설명 없이 결과 문장만 출력.",
    user: [
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      prefix
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }
}
