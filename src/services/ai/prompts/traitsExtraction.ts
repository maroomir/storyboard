export const TraitsExtractionPrompt = {
  instruction(characterName: string, aliases?: readonly string[]): string {
    let instruction = `다음 스크립트에서 "${characterName}"의 행동, 특징, 성격을 간단히 추출해주세요.`

    if (aliases && aliases.length > 0) {
      instruction += `\n(스크립트에서 "${characterName}"은(는) ${aliases.map((a) => `"${a}"`).join(", ")}(으)로도 언급될 수 있습니다.)`
    }

    instruction += `

중요 규칙:
1. 반드시 "${characterName}"의 특성만 추출하세요.
2. 다른 캐릭터의 이름이나 특성이 포함된 문장은 제외하세요.
3. "${characterName}"이 주어가 되거나 주체가 되는 행동만 추출하세요.
4. 다른 캐릭터에 대한 언급이나 평가는 포함하지 마세요.`

    return instruction
  },

  requirements: [
    "각 항목은 한 줄로 작성",
    "최대 5개까지만 추출",
    "구체적이고 관찰 가능한 특성",
    "반드시 해당 캐릭터의 특성만 추출"
  ],

  examples: [
    "용감하게 적에게 맞섰다",
    "친구를 걱정하는 따뜻한 마음을 보였다",
    "신중하게 상황을 판단했다"
  ],

  config: {
    temperature: 0.3,
    maxTokens: 800
  },

  build(script: string, characterName: string, aliases?: readonly string[]): string {
    const requirementLines = TraitsExtractionPrompt.requirements.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
    const exampleLines = TraitsExtractionPrompt.examples.map((example) => `- ${example}`).join("\n")

    return `${TraitsExtractionPrompt.instruction(characterName, aliases)}

추출 규칙:
${requirementLines}

스크립트:
${script}

위 스크립트에서 "${characterName}"의 특성만 정확히 추출해주세요.
다른 캐릭터의 이름이나 특성이 포함된 문장은 제외하세요.

형식 예시:
${exampleLines}`
  }
} as const
