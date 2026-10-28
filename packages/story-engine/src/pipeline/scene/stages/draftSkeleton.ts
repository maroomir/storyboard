import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { SkeletonDrafter } from '#engine/pipeline/scene/skeletonDrafter';
import { assertNotCancelled } from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';

export class DraftSkeletonStage implements ISceneStage {
  public readonly id: SceneStageId = 'draftSkeleton';

  public async run(run: SceneGenerationRun): Promise<void> {
    await new SkeletonDrafter(run).draft();
    assertNotCancelled(run.shouldCancel);
  }
}
