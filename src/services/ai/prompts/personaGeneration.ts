import type { Character } from "@/domain/Character"

export const PersonaGenerationPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 500
  },
  build(character: Character): string {
    const parts = [
      `이름: ${character.name}`,
      character.description ? `설명: ${character.description}` : undefined,
      character.role ? `역할: ${character.role}` : undefined,
      character.traits && character.traits.length > 0 ? `특징: ${character.traits.slice(0, 10).join(", ")}` : undefined
    ].filter((part): part is string => Boolean(part))

    return [
      "캐릭터 정보를 바탕으로 1인칭 페르소나를 생성해주세요.",
      "'나는 ...' 형식으로, 200자 내외 한국어로 작성하세요.",
      "성격과 행동 패턴이 드러나야 합니다.",
      "",
      ...parts
    ].join("\n")
  }
} as const
