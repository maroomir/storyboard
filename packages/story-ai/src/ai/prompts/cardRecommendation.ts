import { isCharacterRole } from '@seedkernel/wasm';
import type { CharacterRole } from '@seedkernel/wasm';
import { type PromptArtifact, type PromptVariantId } from './types';

export type RecommendationCategory = 'character' | 'background';

export interface RecommendedEntity {
  readonly name: string;
  readonly role?: CharacterRole;
  readonly description?: string;
}

export const CardRecommendationPrompt = {
  config: {
    temperature: 0.2,
    maxTokens: 700,
  },
  build(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    if (variant === 'xs') {
      return buildXs(body, category, knownNames);
    }

    return category === 'character'
      ? buildCharacter(body, knownNames)
      : buildBackground(body, knownNames);
  },
} as const;

function exclusionLine(knownNames: readonly string[]): string | undefined {
  const labels = knownNames.map((name) => name.trim()).filter((name) => name.length > 0);

  if (labels.length === 0) {
    return undefined;
  }

  return `다음 이름은 이미 카드로 등록되어 있으니 제외하라: ${labels.join(', ')}.`;
}

function buildCharacter(body: string, knownNames: readonly string[]): PromptArtifact {
  return {
    system: [
      '본문에 등장하는 인물(캐릭터)을 모두 찾아라.',
      'name: 본문에 나온 고유한 호칭이나 이름. 대명사나 일반 역할 호칭(그, 그녀, 점원 등)은 제외.',
      'role: 비중 추정값으로 "main", "supporting", "extra" 중 하나. 불확실하면 "extra".',
      'description: 인물을 한 줄로 설명(본문 근거).',
      exclusionLine(knownNames),
      '본문에 명시되지 않은 인물은 추측하지 말 것.',
      '설명 없이 JSON 배열만 출력하라.',
      '[{"name":"","role":"extra","description":""}]',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
    user: ['[본문]', body].join('\n'),
  };
}

function buildBackground(body: string, knownNames: readonly string[]): PromptArtifact {
  return {
    system: [
      '본문에 등장하는 장소나 배경을 모두 찾아라.',
      'name: 장소·공간의 고유한 이름(예: 학교 정문, 옥상). 일반 명사 단독(예: 방, 길)은 제외.',
      'description: 배경을 한 줄로 설명(본문 근거).',
      exclusionLine(knownNames),
      '본문에 명시되지 않은 배경은 추측하지 말 것.',
      '설명 없이 JSON 배열만 출력하라.',
      '[{"name":"","description":""}]',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
    user: ['[본문]', body].join('\n'),
  };
}

function buildXs(
  body: string,
  category: RecommendationCategory,
  knownNames: readonly string[],
): PromptArtifact {
  const shape =
    category === 'character'
      ? '[{"name":"","role":"extra","description":""}]'
      : '[{"name":"","description":""}]';
  const exclusion = exclusionLine(knownNames);
  const target = category === 'character' ? '인물' : '장소/배경';

  return {
    system:
      `본문에 등장하는 ${target}을 JSON 배열로: ${shape}. ${exclusion ?? ''} 본문에 없는 건 추측하지 말 것.`.trim(),
    user: body,
  };
}

function coerceOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function coerceRole(value: unknown): CharacterRole | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return isCharacterRole(trimmed) ? trimmed : undefined;
}

export function coerceCardRecommendations(
  value: unknown[] | null,
  category: RecommendationCategory,
): RecommendedEntity[] {
  if (value === null) {
    return [];
  }

  const result: RecommendedEntity[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const name = coerceOptionalString(record.name);

    if (name === undefined) {
      continue;
    }

    const description = coerceOptionalString(record.description);
    const role = category === 'character' ? coerceRole(record.role) : undefined;

    result.push({
      name,
      ...(role !== undefined ? { role } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  return result;
}
