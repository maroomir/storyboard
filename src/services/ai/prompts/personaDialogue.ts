import type { Background } from "../../../domain/Background"

export const PersonaDialoguePrompt = {
  config: {
    temperature: 0.8,
    maxTokens: 2000
  },
  build(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string
  ): { readonly system: string; readonly user: string } {
    const system = [
      "주어진 상황에서 캐릭터들의 페르소나를 바탕으로 자연스러운 대화와 장면을 작성해주세요.",
      "대화는 '캐릭터명: 대사' 형식을 사용하세요.",
      "행동, 표정, 감정을 함께 서술하세요.",
      background.description ? `배경 설명: ${background.description}` : undefined,
      background.country ? `국가/지역: ${background.country}` : undefined,
      background.category ? `카테고리: ${background.category}` : undefined
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")

    const personaLines = Array.from(personas.entries()).flatMap(([name, persona]) => ["", `[${name}]`, persona])

    const user = [
      personaLines.length > 0 ? "등장 캐릭터 페르소나:" : undefined,
      ...personaLines,
      previousContext ? `\n이전 장면:\n${previousContext}` : undefined,
      `\n상황:\n${situation}`,
      "\n위 상황에서 캐릭터들의 대화와 행동을 작성해주세요."
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")

    return { system, user }
  }
} as const
