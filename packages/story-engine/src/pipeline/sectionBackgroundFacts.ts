import { placeWordSet } from '#engine/pipeline/sceneCoordinates';

const ELSEWHERE_LABEL: string = '다른 자리';

export function scopeBackgroundFacts(
  facts: readonly string[],
  sectionPlaces: readonly string[],
  scenePlaces: readonly string[],
): string[] {
  const here: Set<string> = placeWordSet(sectionPlaces);
  const anywhere: Set<string> = placeWordSet(scenePlaces);

  if (here.size === 0 || anywhere.size === 0) {
    return [...facts];
  }

  return facts.map((fact) => {
    const elsewhere: string[] = [...anywhere].filter(
      (word) => fact.includes(word) && !here.has(word),
    );
    return elsewhere.length === 0 ? fact : `[${ELSEWHERE_LABEL}: ${elsewhere.join(', ')}] ${fact}`;
  });
}
