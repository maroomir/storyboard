export interface InlineCompletionPromptContext {
  readonly activeCharacter?: string
  readonly background?: string
}

export const InlineCompletionPrompt = {
  config: {
    temperature: 0.5,
    maxTokens: 120
  },
  build(prefix: string, context: InlineCompletionPromptContext = {}): string {
    return [
      "당신은 소설/시나리오 공동 집필 도우미입니다.",
      "커서 직전 문맥을 이어서 자연스러운 한 줄~두 줄의 짧은 텍스트만 제안하세요.",
      "설명, 따옴표, 코드블록 없이 완성 문장만 출력하세요.",
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      "",
      "[커서 직전 텍스트]",
      prefix
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }
} as const
