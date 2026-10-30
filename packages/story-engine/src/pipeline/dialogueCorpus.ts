import {
  resolveSceneOrder,
  type SceneDialogueRecord,
  type SceneDialogueTurn,
} from '@storyboard/story-model';

import { pipelineDefaults } from '#engine/pipeline/pipelineDefaults';

export const VOICE_SAMPLE_LIMIT: number = pipelineDefaults.voiceSamples.limit;

export interface VoiceSampleBounds {
  readonly minimumLength: number;
  readonly maximumLength: number;
}

export function selectRepresentativeDialogue(
  records: readonly SceneDialogueRecord[],
  characterId: string,
  currentSceneStem: string,
  limit: number = VOICE_SAMPLE_LIMIT,
  bounds: VoiceSampleBounds = pipelineDefaults.voiceSamples,
): string[] {
  const candidates: string[] = collectCandidates(records, characterId, currentSceneStem, bounds);

  if (candidates.length <= limit) {
    return candidates;
  }

  const stride: number = candidates.length / limit;
  return Array.from(
    { length: limit },
    (_, bucket) => candidates[Math.floor(bucket * stride)] as string,
  );
}

function collectCandidates(
  records: readonly SceneDialogueRecord[],
  characterId: string,
  currentSceneStem: string,
  bounds: VoiceSampleBounds,
): string[] {
  const currentOrder: number = resolveSceneOrder(currentSceneStem) ?? Number.MAX_SAFE_INTEGER;
  const ordered: SceneDialogueRecord[] = records
    .filter((record) => sceneOrderOf(record) < currentOrder)
    .sort((left, right) => sceneOrderOf(left) - sceneOrderOf(right));

  const seen: Set<string> = new Set<string>();
  const candidates: string[] = [];

  for (const record of ordered) {
    const turns: SceneDialogueTurn[] = [...record.turns].sort(
      (left, right) => left.index - right.index,
    );

    for (const turn of turns) {
      if (turn.speaker !== characterId) {
        continue;
      }

      const text: string = turn.text.trim();
      if (text.length < bounds.minimumLength || text.length > bounds.maximumLength) {
        continue;
      }

      if (seen.has(text)) {
        continue;
      }

      seen.add(text);
      candidates.push(text);
    }
  }

  return candidates;
}

function sceneOrderOf(record: SceneDialogueRecord): number {
  return resolveSceneOrder(record.sceneStem) ?? Number.MAX_SAFE_INTEGER;
}
