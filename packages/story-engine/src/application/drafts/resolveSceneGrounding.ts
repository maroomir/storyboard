import type { SceneGroundingFieldKey, SceneGroundingGap, StoryUri } from '@storyboard/story-model';
import {
  computeSceneGroundingInputKey,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  type SceneFile,
  type SceneGrounding,
} from '@storyboard/story-model';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { GenerateDraftRequest } from '#engine/application/drafts/draftGenerationContract';
import type { ISceneGroundingGapRepository } from '#engine/application/drafts/draftRepositories';

export type SceneGroundingOutcome =
  | { readonly kind: 'resolved'; readonly scene: SceneFile }
  | { readonly kind: 'cancelled' };

export interface SceneGroundingResolverDependencies {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
}

export type SceneGroundingRequest = Pick<
  GenerateDraftRequest,
  'skipSceneGrounding' | 'confirmSceneGrounding'
>;

export interface SceneGroundingTarget {
  readonly workspaceRoot: StoryUri;
  readonly sceneUri: StoryUri;
  readonly scene: SceneFile;
  readonly characterNames: readonly string[];
}

type GroundingDecision =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'approved'; readonly grounding: SceneGrounding };

export class SceneGroundingResolver {
  public constructor(private readonly dependencies: SceneGroundingResolverDependencies) {}

  public async resolve(
    target: SceneGroundingTarget,
    request: SceneGroundingRequest,
  ): Promise<SceneGroundingOutcome> {
    const { scene } = target;
    const existing: SceneGrounding | undefined = scene.frontmatter.grounding;
    const missingFields: SceneGroundingFieldKey[] = missingSceneGroundingFields(existing);

    if (request.skipSceneGrounding || missingFields.length === 0) {
      return { kind: 'resolved', scene };
    }

    if (await this.hasRecordedGroundingGap(target, missingFields)) {
      return { kind: 'resolved', scene };
    }

    const decision: GroundingDecision = await this.decideGrounding(target, missingFields, request);

    if (decision.kind === 'unchanged') {
      return { kind: 'resolved', scene };
    }

    if (decision.kind === 'cancelled') {
      return { kind: 'cancelled' };
    }

    return {
      kind: 'resolved',
      scene: await this.applyApprovedGrounding(target, decision.grounding),
    };
  }

  private async decideGrounding(
    target: SceneGroundingTarget,
    missingFields: SceneGroundingFieldKey[],
    request: SceneGroundingRequest,
  ): Promise<GroundingDecision> {
    const proposed: SceneGrounding | undefined = await this.proposeGrounding(target, missingFields);

    if (proposed === undefined) {
      return { kind: 'unchanged' };
    }

    const merged: SceneGrounding = mergeSceneGrounding(target.scene.frontmatter.grounding, proposed);

    const approved: SceneGrounding | undefined =
      this.dependencies.host.configBridge.isSceneGroundingAutoApproveEnabled()
        ? merged
        : await this.requestApproval(target.scene, merged, missingFields, request);

    return approved ? { kind: 'approved', grounding: approved } : { kind: 'cancelled' };
  }

  private async hasRecordedGroundingGap(
    target: SceneGroundingTarget,
    missingFields: readonly SceneGroundingFieldKey[],
  ): Promise<boolean> {
    const { workspaceRoot, scene, characterNames } = target;
    const gaps: ISceneGroundingGapRepository = this.dependencies.repositories.sceneGroundingGaps;
    const gap: SceneGroundingGap | undefined = await gaps.read(workspaceRoot, scene.stem);

    return (
      gap?.inputKey === computeSceneGroundingInputKey(scene, characterNames) &&
      missingFields.every((field) => gap.fields.includes(field))
    );
  }

  private async applyApprovedGrounding(
    target: SceneGroundingTarget,
    approved: SceneGrounding,
  ): Promise<SceneFile> {
    const { host, repositories } = this.dependencies;
    const { scene } = target;

    try {
      await repositories.scenes.writeGrounding(target.sceneUri, approved);
    } catch (error) {
      host.logger.warn(`씬 사실 시트를 저장하지 못했습니다: ${String(error)}`);
    }

    const groundedScene: SceneFile = {
      ...scene,
      frontmatter: { ...scene.frontmatter, grounding: approved },
    };
    await this.recordGroundingGap(target.workspaceRoot, groundedScene, target.characterNames);

    return groundedScene;
  }

  private async recordGroundingGap(
    workspaceRoot: StoryUri,
    scene: SceneFile,
    characterNames: readonly string[],
  ): Promise<void> {
    const stillMissing: SceneGroundingFieldKey[] = missingSceneGroundingFields(
      scene.frontmatter.grounding,
    );
    const gap: SceneGroundingGap | undefined =
      stillMissing.length === 0
        ? undefined
        : { inputKey: computeSceneGroundingInputKey(scene, characterNames), fields: stillMissing };

    try {
      await this.dependencies.repositories.sceneGroundingGaps.write(workspaceRoot, scene.stem, gap);
    } catch (error) {
      this.dependencies.host.logger.warn(
        `비어 있는 사실 시트 칸을 기록하지 못했습니다: ${String(error)}`,
      );
    }
  }

  private async proposeGrounding(
    target: SceneGroundingTarget,
    missingFields: ReturnType<typeof missingSceneGroundingFields>,
  ): Promise<SceneGrounding | undefined> {
    const { host, ai } = this.dependencies;
    const { scene } = target;

    try {
      return await ai.gateway.createService(target.sceneUri).proposeSceneGrounding(
        {
          sceneBody: scene.body,
          missingFields,
          characterNames: target.characterNames,
          knownGrounding: scene.frontmatter.grounding,
        },
        {
          providerId: ai.gateway.getTaskProvider('sceneGrounding'),
          attribution: { primary: { kind: 'scene', id: scene.stem } },
        },
      );
    } catch (error) {
      host.logger.warn(`씬 사실 시트를 제안하지 못했습니다: ${String(error)}`);
      return undefined;
    }
  }

  private async requestApproval(
    scene: SceneFile,
    merged: SceneGrounding,
    missingFields: ReturnType<typeof missingSceneGroundingFields>,
    request: SceneGroundingRequest,
  ): Promise<SceneGrounding | undefined> {
    if (!request.confirmSceneGrounding) {
      return merged;
    }

    return await request.confirmSceneGrounding({
      sceneStem: scene.stem,
      grounding: merged,
      proposedFields: missingFields,
    });
  }
}
