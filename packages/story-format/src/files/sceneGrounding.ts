import {
  sceneGroundingFieldKeys,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '../scene';
import { parseSceneCard, serializeSceneCard } from './scene';

export function missingSceneGroundingFields(
  grounding: SceneGrounding | undefined,
): SceneGroundingFieldKey[] {
  return sceneGroundingFieldKeys.filter((key) => {
    const value = grounding?.[key];
    return value === undefined || value.trim().length === 0;
  });
}

export function isSceneGroundingComplete(grounding: SceneGrounding | undefined): boolean {
  return missingSceneGroundingFields(grounding).length === 0;
}

// 사용자가 적어 둔 값이 항상 이긴다. 제안은 비어 있는 필드만 채운다.
export function mergeSceneGrounding(
  existing: SceneGrounding | undefined,
  proposed: SceneGrounding | undefined,
): SceneGrounding {
  const merged: Record<string, string> = {};

  for (const key of sceneGroundingFieldKeys) {
    const kept = existing?.[key]?.trim();
    const filled = kept && kept.length > 0 ? kept : proposed?.[key]?.trim();

    if (filled && filled.length > 0) {
      merged[key] = filled;
    }
  }

  return merged;
}

// NOTE: Scene card 직렬화는 canonical이라 grounding만 바꿔도 전체를 다시 직렬화한다.
export function applySceneGrounding(rawScene: string, grounding: SceneGrounding): string {
  const card = parseSceneCard(rawScene);

  if (Object.keys(grounding).length === 0) {
    return serializeSceneCard(card);
  }

  return serializeSceneCard({ ...card, grounding });
}
