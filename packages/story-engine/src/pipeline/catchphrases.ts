import { escapeRegExp, type CharacterCard } from '@storyboard/story-model';

export interface CatchphraseCount {
  readonly phrase: string;
  readonly count: number;
}

export interface CatchphraseBudget {
  readonly characterName: string;
  readonly phrases: readonly string[];
  readonly limit: number;
}

export interface SectionCatchphraseBudgetInput {
  readonly characters: readonly CharacterCard[];
  readonly sceneLimit: number;
  readonly sectionTargetLengths: readonly number[];
}

const smallestSectionCatchphraseLimit: number = 1;

export function countCatchphrase(text: string, phrase: string): number {
  return (text.match(new RegExp(`(^|[^가-힣])${escapeRegExp(phrase)}`, 'g')) ?? []).length;
}

export function countCatchphrases(text: string, phrases: readonly string[]): CatchphraseCount[] {
  return phrases
    .map((phrase) => ({ phrase, count: countCatchphrase(text, phrase) }))
    .filter((entry) => entry.phrase.length > 0 && entry.count > 0);
}

export function sumCatchphraseCounts(counts: readonly CatchphraseCount[]): number {
  return counts.reduce((sum, entry) => sum + entry.count, 0);
}

export function planSectionCatchphraseBudgets(
  input: SectionCatchphraseBudgetInput,
): CatchphraseBudget[][] {
  const speakers: CharacterCard[] = input.characters.filter((character) =>
    (character.catchphrases ?? []).some((phrase) => phrase.trim().length > 0),
  );
  const totalTargetLength: number = input.sectionTargetLengths.reduce(
    (sum, length) => sum + length,
    0,
  );
  if (input.sceneLimit <= 0 || totalTargetLength <= 0 || speakers.length === 0) {
    return input.sectionTargetLengths.map((): CatchphraseBudget[] => []);
  }

  return input.sectionTargetLengths.map((targetLength): CatchphraseBudget[] => {
    const limit: number = Math.max(
      smallestSectionCatchphraseLimit,
      Math.floor((input.sceneLimit * targetLength) / totalTargetLength),
    );
    return speakers.map((character) => ({
      characterName: character.name,
      phrases: (character.catchphrases ?? []).filter((phrase) => phrase.trim().length > 0),
      limit,
    }));
  });
}

export function describeCatchphraseBudget(budget: CatchphraseBudget): string {
  const phrases: string = budget.phrases.map((phrase) => `«${phrase}»`).join('·');
  return `${budget.characterName}: ${phrases} 모두 합쳐 ${budget.limit}번까지`;
}
