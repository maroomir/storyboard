import type { Character } from "@/domain/Character"
import { type PromptArtifact, type PromptVariantId } from "./types"

export const PersonaGenerationPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 500
  },
  build(character: Character, variant: PromptVariantId = "generic"): PromptArtifact {
    const parts = [
      `이름: ${character.name}`,
      character.description ? `설명: ${character.description}` : undefined,
      character.role ? `역할: ${character.role}` : undefined,
      character.traits && character.traits.length > 0 ? `특징: ${character.traits.slice(0, 10).join(", ")}` : undefined
    ].filter((part): part is string => Boolean(part))

    return variant === "xs" ? buildXs(parts) : buildGeneric(parts)
  }
} as const

function buildGeneric(parts: readonly string[]): PromptArtifact {
  return {
    system: [
      "캐릭터 정보를 바탕으로 1인칭 페르소나를 작성하라.",
      "'나는 ...' 형식의 한국어 200자 내외로 작성하라.",
      "성격과 행동 패턴이 드러나야 한다."
    ].join("\n"),
    user: parts.join("\n")
  }
}

function buildXs(parts: readonly string[]): PromptArtifact {
  return {
    system: "1인칭 페르소나 생성. '나는 ...' 형식, 200자 내외, 한국어.",
    user: parts.join("\n")
  }
}
