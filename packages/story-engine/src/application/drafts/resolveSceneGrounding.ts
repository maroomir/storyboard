import type { StoryUri } from '@storyboard/story-model';
import {
  computeSceneGroundingInputKey,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  type SceneFile,
  type SceneGrounding,
} from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';

export type SceneGroundingOutcome =
  | { readonly kind: 'resolved'; readonly scene: SceneFile }
  | { readonly kind: 'cancelled' };

// 씬을 구체적 사건으로 못박는 4개 사실을 생성 전에 확정한다. 사용자가 적어 둔 값은 그대로 두고
// 비어 있는 필드만 AI 제안으로 채운 뒤 씬 frontmatter에 남겨, 다음 생성에서도 같은 사실을 쓴다.
export async function resolveSceneGrounding(
  workspaceRoot: StoryUri,
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGroundingOutcome> {
  const existing = scene.frontmatter.grounding;
  const missingFields = missingSceneGroundingFields(existing);

  // NOTE: 사실 시트를 건너뛰라는 것과 사용자가 승인을 거절한 것은 다르다. 앞은 있는 값으로 그대로
  // 생성하고, 뒤만 생성을 취소한다. 물어볼 UI가 없는 호스트가 앞이다.
  if (options.skipSceneGrounding || missingFields.length === 0) {
    return { kind: 'resolved', scene };
  }

  // 같은 씬·인물로 이미 물었는데 모델이 비워 둔 칸이면 다시 물어도 같은 답에 같은 비용이 든다.
  const gaps = options.sceneGroundingGapRepository;
  const gap = await gaps.read(workspaceRoot, scene.stem);
  if (
    gap?.inputKey === computeSceneGroundingInputKey(scene, characterNames) &&
    missingFields.every((field) => gap.fields.includes(field))
  ) {
    return { kind: 'resolved', scene };
  }

  const proposed = await proposeGrounding(sceneUri, scene, characterNames, missingFields, options);

  if (proposed === undefined) {
    return { kind: 'resolved', scene };
  }

  const merged = mergeSceneGrounding(existing, proposed);

  const approved = options.configBridge.isSceneGroundingAutoApproveEnabled()
    ? merged
    : await requestApproval(scene, merged, missingFields, options);

  if (!approved) {
    return { kind: 'cancelled' };
  }

  try {
    await options.sceneRepository.writeGrounding(sceneUri, approved);
  } catch (error) {
    options.logger.warn(`씬 사실 시트를 저장하지 못했습니다: ${String(error)}`);
  }

  const groundedScene = { ...scene, frontmatter: { ...scene.frontmatter, grounding: approved } };
  await recordGroundingGap(workspaceRoot, groundedScene, characterNames, options);

  return { kind: 'resolved', scene: groundedScene };
}

// 다음 실행이 읽을 씬 그대로를 열쇠로 남긴다. 칸이 다 차면 기록을 지운다. 기록은 비용을 아끼는
// 보조이므로 실패해도 생성을 막지 않는다.
async function recordGroundingGap(
  workspaceRoot: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: GenerateDraftWorkflowOptions,
): Promise<void> {
  const stillMissing = missingSceneGroundingFields(scene.frontmatter.grounding);
  const gap =
    stillMissing.length === 0
      ? undefined
      : { inputKey: computeSceneGroundingInputKey(scene, characterNames), fields: stillMissing };

  try {
    await options.sceneGroundingGapRepository.write(workspaceRoot, scene.stem, gap);
  } catch (error) {
    options.logger.warn(`비어 있는 사실 시트 칸을 기록하지 못했습니다: ${String(error)}`);
  }
}

async function proposeGrounding(
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  missingFields: ReturnType<typeof missingSceneGroundingFields>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGrounding | undefined> {
  try {
    return await options.aiGateway.createService(sceneUri).proposeSceneGrounding(
      {
        sceneBody: scene.body,
        missingFields,
        characterNames,
        knownGrounding: scene.frontmatter.grounding,
      },
      {
        providerId: options.aiGateway.getTaskProvider('sceneGrounding'),
        attribution: { primary: { kind: 'scene', id: scene.stem } },
      },
    );
  } catch (error) {
    // 사실 시트는 품질 보조 단계다. 제안에 실패해도 생성 자체는 막지 않는다. 실패는 «모델이 비워
    // 둔 칸»이 아니므로 기록하지 않고 다음 실행에서 다시 묻는다.
    options.logger.warn(`씬 사실 시트를 제안하지 못했습니다: ${String(error)}`);
    return undefined;
  }
}

async function requestApproval(
  scene: SceneFile,
  merged: SceneGrounding,
  missingFields: ReturnType<typeof missingSceneGroundingFields>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGrounding | undefined> {
  // NOTE: 일괄 생성·소설 파이프라인처럼 UI가 없는 호출에는 승인 콜백이 없다. 그때는 흐름을 막지 않고
  // 제안을 그대로 쓴다.
  if (!options.confirmSceneGrounding) {
    return merged;
  }

  return await options.confirmSceneGrounding({
    sceneStem: scene.stem,
    grounding: merged,
    proposedFields: missingFields,
  });
}
