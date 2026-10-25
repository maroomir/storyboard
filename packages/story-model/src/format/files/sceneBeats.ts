import { parseSceneCard, serializeSceneCard } from './scene';
import type { SceneBeat, SceneCard } from '#model/format/scene';

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

export function applySceneBeats(rawScene: string, beats: readonly SceneBeat[]): string {
  const card: SceneCard = parseSceneCard(rawScene);

  return serializeSceneCard({ ...card, beats: [...beats] });
}
