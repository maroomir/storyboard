import type { SceneGroundingFieldKey, SceneGroundingGap, StoryUri } from '@storyboard/story-model';
import {
  computeSceneGroundingInputKey,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  type SceneFile,
  type SceneGrounding,
} from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from './generateDraftTypes';
import type { ISceneGroundingGapRepository } from '#engine/application/drafts/draftRepositories';

export type SceneGroundingOutcome =
  | { readonly kind: 'resolved'; readonly scene: SceneFile }
  | { readonly kind: 'cancelled' };

export async function resolveSceneGrounding(
  workspaceRoot: StoryUri,
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGroundingOutcome> {
  const existing: SceneGrounding | undefined = scene.frontmatter.grounding;
  const missingFields: SceneGroundingFieldKey[] = missingSceneGroundingFields(existing);

  if (options.skipSceneGrounding || missingFields.length === 0) {
    return { kind: 'resolved', scene };
  }

  const gaps: ISceneGroundingGapRepository = options.repositories.sceneGroundingGaps;
  const gap: SceneGroundingGap | undefined = await gaps.read(workspaceRoot, scene.stem);
  if (
    gap?.inputKey === computeSceneGroundingInputKey(scene, characterNames) &&
    missingFields.every((field) => gap.fields.includes(field))
  ) {
    return { kind: 'resolved', scene };
  }

  const proposed: SceneGrounding | undefined = await proposeGrounding(
    sceneUri,
    scene,
    characterNames,
    missingFields,
    options,
  );

  if (proposed === undefined) {
    return { kind: 'resolved', scene };
  }

  const merged: SceneGrounding = mergeSceneGrounding(existing, proposed);

  const approved: SceneGrounding | undefined =
    options.host.configBridge.isSceneGroundingAutoApproveEnabled()
      ? merged
      : await requestApproval(scene, merged, missingFields, options);

  if (!approved) {
    return { kind: 'cancelled' };
  }

  try {
    await options.repositories.scenes.writeGrounding(sceneUri, approved);
  } catch (error) {
    options.host.logger.warn(`씬 사실 시트를 저장하지 못했습니다: ${String(error)}`);
  }

  const groundedScene: SceneFile = {
    ...scene,
    frontmatter: { ...scene.frontmatter, grounding: approved },
  };
  await recordGroundingGap(workspaceRoot, groundedScene, characterNames, options);

  return { kind: 'resolved', scene: groundedScene };
}

async function recordGroundingGap(
  workspaceRoot: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  options: GenerateDraftWorkflowOptions,
): Promise<void> {
  const stillMissing: SceneGroundingFieldKey[] = missingSceneGroundingFields(
    scene.frontmatter.grounding,
  );
  const gap: SceneGroundingGap | undefined =
    stillMissing.length === 0
      ? undefined
      : { inputKey: computeSceneGroundingInputKey(scene, characterNames), fields: stillMissing };

  try {
    await options.repositories.sceneGroundingGaps.write(workspaceRoot, scene.stem, gap);
  } catch (error) {
    options.host.logger.warn(`비어 있는 사실 시트 칸을 기록하지 못했습니다: ${String(error)}`);
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
    return await options.ai.gateway.createService(sceneUri).proposeSceneGrounding(
      {
        sceneBody: scene.body,
        missingFields,
        characterNames,
        knownGrounding: scene.frontmatter.grounding,
      },
      {
        providerId: options.ai.gateway.getTaskProvider('sceneGrounding'),
        attribution: { primary: { kind: 'scene', id: scene.stem } },
      },
    );
  } catch (error) {
    options.host.logger.warn(`씬 사실 시트를 제안하지 못했습니다: ${String(error)}`);
    return undefined;
  }
}

async function requestApproval(
  scene: SceneFile,
  merged: SceneGrounding,
  missingFields: ReturnType<typeof missingSceneGroundingFields>,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGrounding | undefined> {
  if (!options.confirmSceneGrounding) {
    return merged;
  }

  return await options.confirmSceneGrounding({
    sceneStem: scene.stem,
    grounding: merged,
    proposedFields: missingFields,
  });
}
