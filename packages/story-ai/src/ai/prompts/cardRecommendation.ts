import { isCharacterRole } from '@storyboard/story-model';
import type { CharacterRole } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export type RecommendationCategory = 'character' | 'background';

export interface RecommendedEntity {
  readonly name: string;
  readonly role?: CharacterRole;
  readonly description?: string;
}

export const CardRecommendationPrompt: PromptModule<
  [
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    variant?: PromptVariantId,
  ]
> = {
  config: promptTuning('cardRecommendation'),
  build(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const knownNameList: string = knownNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .join(', ');

    return renderPrompt('cardRecommendation', variant, {
      view: { body, isCharacter: category === 'character', knownNameList },
    });
  },
};

function coerceOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function coerceRole(value: unknown): CharacterRole | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed: string = value.trim();
  return isCharacterRole(trimmed) ? trimmed : undefined;
}

export function coerceCardRecommendations(
  value: unknown[] | null,
  category: RecommendationCategory,
): RecommendedEntity[] {
  if (value === null) {
    return [];
  }

  const recommendedEntities: RecommendedEntity[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const name: string | undefined = coerceOptionalString(record.name);

    if (name === undefined) {
      continue;
    }

    const description: string | undefined = coerceOptionalString(record.description);
    const role: 'main' | 'supporting' | 'extra' | undefined =
      category === 'character' ? coerceRole(record.role) : undefined;

    recommendedEntities.push({
      name,
      ...(role !== undefined ? { role } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  return recommendedEntities;
}
