import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  assertNotCancelled,
  describeBackgroundForScene,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';

export class DescribeBackgroundStage implements ISceneStage {
  public readonly id: SceneStageId = 'describeBackground';

  public async run(run: SceneGenerationRun): Promise<void> {
    if (run.context.background) {
      run.background = await describeBackgroundForScene(
        run.context.background,
        run.aiService,
        run.input.backgroundStore,
        run.input.backgroundRecentExcerpt,
      );
    }
    assertNotCancelled(run.shouldCancel);
  }
}
