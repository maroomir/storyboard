import { parseSceneCard, serializeSceneCard } from './scene';

// 목표 분량을 비트당 글자 수로 나눠 비트 수를 정한다. 목표가 없는 씬은 최소 비트 수만 뽑는다.
export function planSceneBeatCount(
  targetLength: number | undefined,
  charsPerBeat: number,
  minBeats: number,
): number {
  if (targetLength === undefined || targetLength <= 0) {
    return minBeats;
  }

  return Math.max(minBeats, Math.ceil(targetLength / charsPerBeat));
}

// NOTE: Scene card 직렬화는 canonical이라 beats만 바꿔도 전체를 다시 직렬화한다.
export function applySceneBeats(rawScene: string, beats: readonly string[]): string {
  const card = parseSceneCard(rawScene);

  return serializeSceneCard({ ...card, beats: [...beats] });
}
