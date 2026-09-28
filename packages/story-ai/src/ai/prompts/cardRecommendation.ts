import { isCharacterRole } from '@storyboard/story-format';
import type { CharacterRole } from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export type RecommendationCategory = 'character' | 'background';

export interface RecommendedEntity {
  readonly name: string;
  readonly role?: CharacterRole;
  readonly description?: string;
}

export const CardRecommendationPrompt = {
  config: promptTuning('cardRecommendation'),
  build(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const knownNameList = knownNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .join(', ');

    return renderPrompt('cardRecommendation', variant, {
      view: { body, isCharacter: category === 'character', knownNameList },
    });
  },
} as const;

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
