import type { SceneGroundingFieldKey, SceneGroundingGap, StoryUri } from '@storyboard/story-model';
import {
  computeSceneGroundingInputKey,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  type SceneFile,
  type SceneGrounding,
} from '@storyboard/story-model';
import type { GenerateDraftWorkflowOptions } from './draftGenerationContract';
import type { ISceneGroundingGapRepository } from '#engine/application/drafts/draftRepositories';

export type SceneGroundingOutcome =
  | { readonly kind: 'resolved'; readonly scene: SceneFile }
  | { readonly kind: 'cancelled' };

type GroundingDecision =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'approved'; readonly grounding: SceneGrounding };

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

  if (await hasRecordedGroundingGap(workspaceRoot, scene, characterNames, missingFields, options)) {
    return { kind: 'resolved', scene };
  }

  const decision: GroundingDecision = await decideGrounding(
    sceneUri,
    scene,
    characterNames,
    missingFields,
    options,
  );

  if (decision.kind === 'unchanged') {
    return { kind: 'resolved', scene };
  }

  if (decision.kind === 'cancelled') {
    return { kind: 'cancelled' };
  }

  return {
    kind: 'resolved',
    scene: await applyApprovedGrounding(
      workspaceRoot,
      sceneUri,
      scene,
      decision.grounding,
      characterNames,
      options,
    ),
  };
}

async function decideGrounding(
  sceneUri: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  missingFields: SceneGroundingFieldKey[],
  options: GenerateDraftWorkflowOptions,
): Promise<GroundingDecision> {
  const proposed: SceneGrounding | undefined = await proposeGrounding(
    sceneUri,
    scene,
    characterNames,
    missingFields,
    options,
  );

  if (proposed === undefined) {
    return { kind: 'unchanged' };
  }

  const merged: SceneGrounding = mergeSceneGrounding(scene.frontmatter.grounding, proposed);

  const approved: SceneGrounding | undefined =
    options.host.configBridge.isSceneGroundingAutoApproveEnabled()
      ? merged
      : await requestApproval(scene, merged, missingFields, options);

  return approved ? { kind: 'approved', grounding: approved } : { kind: 'cancelled' };
}

async function hasRecordedGroundingGap(
  workspaceRoot: StoryUri,
  scene: SceneFile,
  characterNames: readonly string[],
  missingFields: readonly SceneGroundingFieldKey[],
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  const gaps: ISceneGroundingGapRepository = options.repositories.sceneGroundingGaps;
  const gap: SceneGroundingGap | undefined = await gaps.read(workspaceRoot, scene.stem);

  return (
    gap?.inputKey === computeSceneGroundingInputKey(scene, characterNames) &&
    missingFields.every((field) => gap.fields.includes(field))
  );
}

async function applyApprovedGrounding(
  workspaceRoot: StoryUri,
  sceneUri: StoryUri,
  scene: SceneFile,
  approved: SceneGrounding,
  characterNames: readonly string[],
  options: GenerateDraftWorkflowOptions,
): Promise<SceneFile> {
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

  return groundedScene;
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
