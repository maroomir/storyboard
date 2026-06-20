import { type PromptArtifact, type PromptVariantId } from "./types"

export interface DraftCritiqueInput {
  readonly body: string
  readonly intent: string
  readonly characters: readonly string[]
  readonly facts: readonly string[]
  readonly styleConstraints?: readonly string[]
  readonly qualityCriteria?: readonly string[]
}

export const DraftCritiquePrompt = {
  config: {
    temperature: 0.2,
    maxTokens: 2000
  },
  build(input: DraftCritiqueInput, variant: PromptVariantId = "generic"): PromptArtifact {
    return variant === "xs" ? buildXs(input) : buildGeneric(input)
  }
} as const

function buildGeneric(input: DraftCritiqueInput): PromptArtifact {
  return {
    system: [
      "한국어 장편 소설 초안을 비평하는 도우미다.",
      "다음 세 관점만 검토한다: 캐릭터 보이스(voice), 장면 목적 달성(purpose), 불필요한 반복(repetition).",
      "[문체 제약]이 주어지면 이를 위반한 표현을 voice로, [품질 기준] 미달은 purpose로 보고한다.",
      "문법·맞춤법은 보지 않는다. 명백한 문제만 보고하고, 사소하면 severity를 low로 둔다.",
      "설명 없이 JSON 배열만 출력하라.",
      '[{"category":"voice","severity":"high","excerpt":"","comment":""}]',
      "category는 voice|purpose|repetition, severity는 high|low. comment에는 무엇을 어떻게 고칠지 적어라.",
      "문제가 없으면 빈 배열 []을 출력하라."
    ].join("\n"),
    user: buildUserBlock(input)
  }
}

function buildXs(input: DraftCritiqueInput): PromptArtifact {
  return {
    system:
      '초안의 voice/purpose/repetition 문제만 JSON 배열로 반환: [{"category":"voice","severity":"high","excerpt":"","comment":""}] (없으면 []).',
    user: buildUserBlock(input)
  }
}

function buildUserBlock(input: DraftCritiqueInput): string {
  const sections: string[] = []

  if (input.intent.trim().length > 0) {
    sections.push(`[장면 의도]\n${input.intent}`)
  }
  if (input.characters.length > 0) {
    sections.push(`[등장 인물]\n${input.characters.join(", ")}`)
  }
  if (input.facts.length > 0) {
    sections.push(`[설정]\n${input.facts.join("\n")}`)
  }
  if (input.styleConstraints && input.styleConstraints.length > 0) {
    sections.push(`[문체 제약]\n${input.styleConstraints.join("\n")}`)
  }
  if (input.qualityCriteria && input.qualityCriteria.length > 0) {
    sections.push(`[품질 기준]\n${input.qualityCriteria.join("\n")}`)
  }

  sections.push(`[본문]\n${input.body}`)

  return sections.join("\n\n")
}
