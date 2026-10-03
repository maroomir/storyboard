import type { StoryUri } from '@storyboard/story-model';
import {
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

  const proposed = await proposeGrounding(sceneUri, scene, characterNames, missingFields, options);
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

  return {
    kind: 'resolved',
    scene: { ...scene, frontmatter: { ...scene.frontmatter, grounding: approved } },
  };
}

async function proposeGrounding(
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  missingFields: ReturnType<typeof missingSceneGroundingFields>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGrounding> {
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
    // 사실 시트는 품질 보조 단계다. 제안에 실패해도 생성 자체는 막지 않는다.
    options.logger.warn(`씬 사실 시트를 제안하지 못했습니다: ${String(error)}`);
    return {};
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
