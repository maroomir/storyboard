import {
  sceneGroundingFieldKeys,
  type SceneCard,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '#model/format/scene';
import { parseSceneCard, serializeSceneCard } from './scene';

export function missingSceneGroundingFields(
  grounding: SceneGrounding | undefined,
): SceneGroundingFieldKey[] {
  return sceneGroundingFieldKeys.filter((key) => {
    const value: string | undefined = grounding?.[key];
    return value === undefined || value.trim().length === 0;
  });
}

export function isSceneGroundingComplete(grounding: SceneGrounding | undefined): boolean {
  return missingSceneGroundingFields(grounding).length === 0;
}

export function mergeSceneGrounding(
  existing: SceneGrounding | undefined,
  proposed: SceneGrounding | undefined,
): SceneGrounding {
  const merged: Record<string, string> = {};

  for (const key of sceneGroundingFieldKeys) {
    const kept: string | undefined = existing?.[key]?.trim();
    const filled: string | undefined = kept && kept.length > 0 ? kept : proposed?.[key]?.trim();

    if (filled && filled.length > 0) {
      merged[key] = filled;
    }
  }

  return merged;
}

export function applySceneGrounding(rawScene: string, grounding: SceneGrounding): string {
  const card: SceneCard = parseSceneCard(rawScene);

  if (Object.keys(grounding).length === 0) {
    return serializeSceneCard(card);
  }

  return serializeSceneCard({ ...card, grounding });
}
