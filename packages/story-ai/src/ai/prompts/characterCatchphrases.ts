import type { CharacterCard } from '@storyboard/story-model';

export function characterCatchphrases(
  characters: readonly CharacterCard[],
): ReadonlyMap<string, readonly string[]> {
  const catchphrases: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  for (const character of characters) {
    if (character.catchphrases && character.catchphrases.length > 0) {
      catchphrases.set(character.name, character.catchphrases);
    }
  }

  return catchphrases;
}

export function personaCatchphraseView(
  name: string,
  catchphrases: ReadonlyMap<string, readonly string[]> | undefined,
): { readonly hasCatchphrases: boolean; readonly catchphrases: readonly string[] } {
  const items: readonly string[] = catchphrases?.get(name) ?? [];

  return { hasCatchphrases: items.length > 0, catchphrases: items };
}
