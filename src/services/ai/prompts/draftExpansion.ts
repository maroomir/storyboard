export interface DraftExpansionPromptContext {
  readonly activeCharacter?: string
  readonly background?: string
}

export const DraftExpansionPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 2400
  },
  build(selection: string, context: DraftExpansionPromptContext = {}): string {
    return [
      "당신은 장면 확장 전문 작가입니다.",
      "선택된 본문을 같은 문체와 시점으로 2~4배 자연스럽게 확장하세요.",
      "새 정보는 최소화하고, 기존 의미를 유지하며 밀도만 높이세요.",
      "결과는 확장된 본문만 출력하세요.",
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      "",
      "[선택 영역]",
      selection
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }
} as const
