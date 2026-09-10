import { resolveSceneOrder, type SceneDialogueRecord } from '@storyboard/story-format';

import { pipelineDefaults } from './pipelineDefaults';

export const VOICE_SAMPLE_LIMIT = pipelineDefaults.voiceSamples.limit;

const minimumSampleLength = pipelineDefaults.voiceSamples.minimumLength;
const maximumSampleLength = pipelineDefaults.voiceSamples.maximumLength;

// NOTE: 말투 기준점이라 매 생성마다 같은 입력에서 같은 표본이 나와야 한다. AI를 쓰지 않고 씬 순서와
// 길이만으로 고르며, 작품 전체에 고르게 걸치도록 후보를 등분해 각 구간의 첫 대사를 뽑는다.
export function selectRepresentativeDialogue(
  records: readonly SceneDialogueRecord[],
  characterId: string,
  currentSceneStem: string,
  limit: number = VOICE_SAMPLE_LIMIT,
): string[] {
  const candidates = collectCandidates(records, characterId, currentSceneStem);

  if (candidates.length <= limit) {
    return candidates;
  }

  const stride = candidates.length / limit;
  return Array.from(
    { length: limit },
    (_, bucket) => candidates[Math.floor(bucket * stride)] as string,
  );
}

// 뒤 씬의 대사를 표본으로 쓰면 3번 씬이 20번 씬의 말투를 기준으로 삼는다. 인물의 말투는 작품이
// 진행되며 변하므로, 지금 쓰는 씬보다 앞선 것만 남긴다.
function collectCandidates(
  records: readonly SceneDialogueRecord[],
  characterId: string,
  currentSceneStem: string,
): string[] {
  const currentOrder = resolveSceneOrder(currentSceneStem) ?? Number.MAX_SAFE_INTEGER;
  const ordered = records
    .filter((record) => sceneOrderOf(record) < currentOrder)
    .sort((left, right) => sceneOrderOf(left) - sceneOrderOf(right));

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const record of ordered) {
    const turns = [...record.turns].sort((left, right) => left.index - right.index);

    for (const turn of turns) {
      if (turn.speaker !== characterId) {
        continue;
      }

      const text = turn.text.trim();
      if (text.length < minimumSampleLength || text.length > maximumSampleLength) {
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
