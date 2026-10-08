import type { CharacterCard } from '@storyboard/story-model';

// 이름 → 입버릇. 페르소나 맵(이름 → 페르소나)과 같은 열쇠로 뼈대·다듬기 프롬프트에 나란히 실린다.
export function characterCatchphrases(
  characters: readonly CharacterCard[],
): ReadonlyMap<string, readonly string[]> {
  const catchphrases = new Map<string, readonly string[]>();

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
  const items = catchphrases?.get(name) ?? [];

  return { hasCatchphrases: items.length > 0, catchphrases: items };
}
