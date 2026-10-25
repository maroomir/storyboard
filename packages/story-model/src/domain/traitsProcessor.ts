export function calculateSimilarity(leftTrait: string, rightTrait: string): number {
  const leftWords: string[] = normalizeTrait(leftTrait).split(/\s+/).filter(Boolean);
  const rightWords: string[] = normalizeTrait(rightTrait).split(/\s+/).filter(Boolean);

  if (leftWords.join(' ') === rightWords.join(' ')) {
    return 1;
  }

  const totalWords: number = new Set([...leftWords, ...rightWords]).size;

  if (totalWords === 0) {
    return 0;
  }

  const commonWordCount: number = leftWords.filter((word) => rightWords.includes(word)).length;
  return commonWordCount / totalWords;
}

export function removeDuplicateTraits(traits: readonly string[], threshold = 0.8): string[] {
  const uniqueTraits: string[] = [];

  for (const trait of traits) {
    const isDuplicate: boolean = uniqueTraits.some(
      (existingTrait) => calculateSimilarity(trait, existingTrait) > threshold,
    );

    if (!isDuplicate) {
      uniqueTraits.push(trait);
    }
  }

  return uniqueTraits;
}

export function removeExistingTraits(
  newTraits: readonly string[],
  existingTraits: readonly string[],
  threshold = 0.8,
): string[] {
  return newTraits.filter(
    (newTrait) =>
      !existingTraits.some(
        (existingTrait) => calculateSimilarity(newTrait, existingTrait) > threshold,
      ),
  );
}

export function validateTraits(traits: readonly string[]): string[] {
  return traits.filter((trait) => {
    if (trait.length < 10) {
      return false;
    }

    return !meaninglessTraitPatterns.some((pattern) => pattern.test(trait));
  });
}

export function reconcileCharacterTraits(
  extractedTraits: Readonly<Record<string, readonly string[]>>,
  existingTraits: Readonly<Record<string, readonly string[]>> = {},
): Record<string, string[]> {
  const reconciledTraitsByCharacter: Record<string, string[]> = {};

  for (const [characterName, traits] of Object.entries(extractedTraits)) {
    const validatedTraits: string[] = validateTraits(traits);
    const uniqueFromExisting: string[] = removeExistingTraits(
      validatedTraits,
      existingTraits[characterName] ?? [],
    );
    reconciledTraitsByCharacter[characterName] = removeDuplicateTraits(uniqueFromExisting);
  }

  return reconciledTraitsByCharacter;
}

const meaninglessTraitPatterns: RegExp[] = [/^[가-힣]+이?다$/, /^[가-힣]+이?었다$/];

function normalizeTrait(trait: string): string {
  return trait
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, '')
    .trim();
}
