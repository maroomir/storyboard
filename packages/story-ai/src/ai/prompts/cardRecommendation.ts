import { coerceOptionalString, isCharacterRole } from '@storyboard/story-model';
import type { BibleSubjectKind, CharacterRole } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface RecommendedEntity {
  readonly name: string;
  readonly role?: CharacterRole;
  readonly description?: string;
}

export const CardRecommendationPrompt: PromptModule<
  [
    body: string,
    category: BibleSubjectKind,
    knownNames: readonly string[],
    variant?: PromptVariantId,
  ]
> = {
  config: promptTuning('cardRecommendation'),
  build(
    body: string,
    category: BibleSubjectKind,
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

function coerceRole(value: unknown): CharacterRole | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed: string = value.trim();
  return isCharacterRole(trimmed) ? trimmed : undefined;
}

export function coerceCardRecommendations(
  value: unknown[] | null,
  category: BibleSubjectKind,
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
    const role: CharacterRole | undefined =
      category === 'character' ? coerceRole(record.role) : undefined;

    recommendedEntities.push({
      name,
      ...(role !== undefined ? { role } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  return recommendedEntities;
}
