import type { Background } from "@/domain/Background"
import { voiceStyleLines, type StyleDirective } from "@/shared/styleDirective"
import { type PromptArtifact, type PromptVariantId } from "./types"

export const PersonaDialoguePrompt = {
  config: {
    temperature: 0.8,
    maxTokens: 2000
  },
  build(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    variant: PromptVariantId = "generic",
    style?: StyleDirective
  ): PromptArtifact {
    const system = [
      variant === "xs"
        ? "페르소나 기반 장면 작성. 형식: '캐릭터명: 대사'. 행동/감정도 포함."
        : "주어진 상황에서 캐릭터들의 페르소나를 바탕으로 자연스러운 대화와 장면을 작성하라.",
      variant === "rich" ? "장면 전개는 인물 간 긴장/목표/갈등이 드러나도록 구성하라." : undefined,
      variant === "xs" ? undefined : "대화는 '캐릭터명: 대사' 형식을 사용하라.",
      variant === "xs" ? undefined : "행동, 표정, 감정을 함께 서술하라.",
      background.description ? `배경 설명: ${background.description}` : undefined,
      background.tags && background.tags.length > 0 ? `태그: ${background.tags.join(", ")}` : undefined,
      ...(variant === "xs" ? [] : voiceStyleLines(style))
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")

    const personaLines = Array.from(personas.entries()).flatMap(([name, persona]) => ["", `[${name}]`, persona])

    const user = [
      personaLines.length > 0 ? "등장 캐릭터 페르소나:" : undefined,
      ...personaLines,
      previousContext ? `\n이전 장면:\n${previousContext}` : undefined,
      `\n상황:\n${situation}`,
      "\n위 상황에서 캐릭터들의 대화와 행동을 작성하라."
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")

    return { system, user }
  }
} as const
