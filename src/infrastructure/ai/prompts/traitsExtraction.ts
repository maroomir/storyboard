import { type PromptArtifact, type PromptVariantId } from './types';

export const TraitsExtractionPrompt = {
  config: {
    temperature: 0.3,
    maxTokens: 800,
  },
  build(
    script: string,
    characterName: string,
    aliases?: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return variant === 'xs'
      ? buildXs(script, characterName, aliases)
      : buildGeneric(script, characterName, aliases);
  },
} as const;

function aliasText(characterName: string, aliases?: readonly string[]): string | undefined {
  if (!aliases || aliases.length === 0) {
    return undefined;
  }
  return `"${characterName}" 별칭: ${aliases.map((alias) => `"${alias}"`).join(', ')}`;
}

function buildGeneric(
  script: string,
  characterName: string,
  aliases?: readonly string[],
): PromptArtifact {
  return {
    system: [
      `"${characterName}"의 행동/특성/성격만 추출하라.`,
      '다른 캐릭터 이름 또는 특성이 포함된 문장은 제외하라.',
      `"${characterName}"이 주체인 행동만 허용한다.`,
      '출력은 불릿 목록, 최대 5개, 각 항목 한 줄.',
      '구체적이고 관찰 가능한 표현만 사용하라.',
    ].join('\n'),
    user: [aliasText(characterName, aliases), '[스크립트]', script]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  };
}

function buildXs(
  script: string,
  characterName: string,
  aliases?: readonly string[],
): PromptArtifact {
  return {
    system: `"${characterName}" 특성만 불릿 최대 5개. 타 캐릭터 내용 금지.`,
    user: [aliasText(characterName, aliases), script]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  };
}
