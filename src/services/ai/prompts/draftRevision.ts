import type { ProjectFormat } from "@/shared/project"
import { type PromptArtifact, type PromptVariantId } from "./types"

export interface DraftRevisionInput {
  readonly body: string
  readonly format: ProjectFormat
  readonly instructions: readonly string[]
  readonly intent: string
  readonly facts: readonly string[]
}

export const DraftRevisionPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 4000
  },
  build(input: DraftRevisionInput, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(input) : buildGeneric(input)
  }
} as const

function buildGeneric(input: DraftRevisionInput): PromptArtifact {
  return {
    system: [
      "한국어 장편 소설 초안을 지시에 따라 다시 쓰는 작가다.",
      "아래 [지시]를 모두 반영해 본문을 수정하되, 지시와 무관한 부분의 분위기와 문체는 유지한다.",
      "설정([설정])과 장면 의도([장면 의도])를 어기지 마라.",
      "설명·머리말 없이 수정된 본문 전체만 출력하라."
    ].join("\n"),
    user: buildUserBlock(input)
  }
}

function buildXs(input: DraftRevisionInput): PromptArtifact {
  return {
    system: "아래 지시를 반영해 본문을 다시 써라. 설명 없이 수정된 본문 전체만 출력하라.",
    user: buildUserBlock(input)
  }
}

function buildUserBlock(input: DraftRevisionInput): string {
  const sections: string[] = [`[지시]\n${input.instructions.map((item) => `- ${item}`).join("\n")}`]

  if (input.intent.trim().length > 0) {
    sections.push(`[장면 의도]\n${input.intent}`)
  }
  if (input.facts.length > 0) {
    sections.push(`[설정]\n${input.facts.join("\n")}`)
  }

  sections.push(`[본문]\n${input.body}`)

  return sections.join("\n\n")
}
