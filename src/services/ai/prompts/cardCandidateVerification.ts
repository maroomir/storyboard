import { type PromptArtifact, type PromptVariantId } from "./types"

export const CardCandidateVerificationPrompt = {
  config: {
    temperature: 0,
    maxTokens: 200
  },
  build(
    body: string,
    characterName: string,
    statements: readonly string[],
    variant: PromptVariantId = "generic"
  ): PromptArtifact {
    const numbered = statements.map((statement, index) => `${index}. ${statement}`).join("\n")
    return variant === "xs" ? buildXs(body, characterName, numbered) : buildGeneric(body, characterName, numbered)
  }
} as const

function buildGeneric(body: string, characterName: string, numbered: string): PromptArtifact {
  return {
    system: [
      `"${characterName}"에 대한 아래 항목 중, 본문에 명시적으로 드러나는 것만 골라라.`,
      "추측·암시·일반 지식으로 보충하지 말고 본문 문장으로 확인되는 항목만 인정하라.",
      "인정하는 항목의 번호만 JSON 배열로 출력하라. 설명 금지. 없으면 []."
    ].join("\n"),
    user: ["[본문]", body, "", "[항목]", numbered].join("\n")
  }
}

function buildXs(body: string, characterName: string, numbered: string): PromptArtifact {
  return {
    system: `"${characterName}" 항목 중 본문에 명시된 번호만 JSON 배열로. 추측 금지. 없으면 [].`,
    user: ["[본문]", body, "[항목]", numbered].join("\n")
  }
}
