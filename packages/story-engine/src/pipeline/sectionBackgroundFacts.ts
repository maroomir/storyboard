import { placeWordSet } from './sceneCoordinates';

// NOTE: 배경 카드의 공간 사실은 씬 단위로 한 묶음이라 모든 구간이 같은 줄을 받았다. 거실 발코니 앞의
// 가림막이 옥상 발코니 대목에 서 있었던 것은 두 자리가 «발코니»를 나눠 쓴 탓이다(#119). 사실이 이 구간의
// 자리 밖 낱말을 언급하면 그 낱말을 앞에 밝혀, 모델이 그 구조·소품을 여기로 옮기지 않게 한다.
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
