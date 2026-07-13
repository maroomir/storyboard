import { applyIdMapping, validateIdMapping, type IdMappingIssue } from '@seedcoat/wasm';

import { setCardId } from '@/domain/cardReferenceRewriter';
import type { CharacterCard } from '@/shared/card';
import type { DecodedSeedContent } from '@/services/seedcoat/projectAdapter';

export class SeedIdMappingConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SeedIdMappingConflictError';
  }
}

export class SeedIdMappingValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SeedIdMappingValidationError';
  }
}

function throwFromMappingIssues(issues: readonly IdMappingIssue[]): void {
  const [issue] = issues;

  if (issue === undefined) {
    return;
  }

  switch (issue.kind) {
    case 'invalid-id':
      throw new SeedIdMappingValidationError(`Invalid card id: ${issue.id}`);
    case 'duplicate-target':
      throw new SeedIdMappingConflictError(
        `Multiple source ids map to the same target id: ${issue.id}`,
      );
    case 'id-collision':
      throw new SeedIdMappingConflictError(`Target id ${issue.id} would be used by multiple cards`);
  }
}

export function validateSeedIdMapping(
  seed: DecodedSeedContent,
  mapping: ReadonlyMap<string, string>,
): void {
  throwFromMappingIssues(validateIdMapping(seed, mapping));
}

export function applySeedIdMapping(
  seed: DecodedSeedContent,
  mapping: ReadonlyMap<string, string>,
): DecodedSeedContent {
  if (mapping.size === 0) {
    return seed;
  }

  validateSeedIdMapping(seed, mapping);

  const remapped = applyIdMapping(seed, mapping);

  // applyIdMapping rewrites ids/relations/characterIds but deliberately leaves
  // the app-specific profile/<id>.png path alone; sync it card-by-card so the
  // convention in setCardId stays the single source of truth.
  const characters = remapped.characters.map((card, index) => {
    const previous = seed.characters[index];

    if (previous === undefined || previous.id === card.id) {
      return card;
    }

    return setCardId({ ...card, id: previous.id }, card.id) as CharacterCard;
  });

  return {
    ...remapped,
    characters,
  };
}
